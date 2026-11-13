// Package storage talks to the S3-compatible object store (Garage): POST
// policies for browser uploads, and server-side reads, writes and deletes.
package storage

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/aws/smithy-go"
)

// ErrNotFound is returned when an object does not exist.
var ErrNotFound = errors.New("object not found")

// Config is what the storage client needs.
type Config struct {
	Endpoint        string
	Region          string
	Bucket          string
	AccessKeyID     string
	SecretAccessKey string
	UploadPath      string
	MaxUploadBytes  int64
	MinUploadBytes  int64
	PolicyTTL       time.Duration
}

// Storage is the S3 client bound to one bucket.
type Storage struct {
	cfg     Config
	client  *s3.Client
	presign *s3.PresignClient
}

// Upload is a POST policy ready to be sent to the browser.
type Upload struct {
	URL       string            `json:"url"`
	Fields    map[string]string `json:"fields"`
	ExpiresAt time.Time         `json:"expiresAt"`
}

// New builds the client. It does not contact the server.
func New(cfg Config) *Storage {
	if cfg.MinUploadBytes == 0 {
		cfg.MinUploadBytes = 1024
	}
	if cfg.PolicyTTL == 0 {
		cfg.PolicyTTL = 15 * time.Minute
	}
	client := s3.New(s3.Options{
		Region:                     cfg.Region,
		BaseEndpoint:               aws.String(cfg.Endpoint),
		UsePathStyle:               true,
		Credentials:                credentials.NewStaticCredentialsProvider(cfg.AccessKeyID, cfg.SecretAccessKey, ""),
		RequestChecksumCalculation: aws.RequestChecksumCalculationWhenRequired,
		ResponseChecksumValidation: aws.ResponseChecksumValidationWhenRequired,
		HTTPClient:                 &http.Client{Timeout: 60 * time.Second},
		RetryMaxAttempts:           2,
	})
	return &Storage{cfg: cfg, client: client, presign: s3.NewPresignClient(client)}
}

// Bucket returns the bucket name.
func (s *Storage) Bucket() string { return s.cfg.Bucket }

// PresignUpload returns a POST policy that only accepts a JPEG of the
// allowed size at exactly key, valid for PolicyTTL.
func (s *Storage) PresignUpload(ctx context.Context, key string, now time.Time) (Upload, error) {
	conditions := []any{
		map[string]string{"key": key},
		map[string]string{"Content-Type": "image/jpeg"},
		[]any{"content-length-range", s.cfg.MinUploadBytes, s.cfg.MaxUploadBytes},
	}
	req, err := s.presign.PresignPostObject(ctx, &s3.PutObjectInput{
		Bucket: aws.String(s.cfg.Bucket),
		Key:    aws.String(key),
	}, func(o *s3.PresignPostOptions) {
		o.Expires = s.cfg.PolicyTTL
		o.Conditions = conditions
	})
	if err != nil {
		return Upload{}, fmt.Errorf("presign post: %w", err)
	}
	fields := make(map[string]string, len(req.Values)+1)
	for k, v := range req.Values {
		lk := strings.ToLower(k)
		if strings.HasPrefix(lk, "x-amz-") {
			k = lk
		}
		fields[k] = v
	}
	fields["Content-Type"] = "image/jpeg"
	return Upload{
		URL:       s.cfg.UploadPath,
		Fields:    fields,
		ExpiresAt: now.Add(s.cfg.PolicyTTL).UTC().Truncate(time.Second),
	}, nil
}

// Head returns the object size.
func (s *Storage) Head(ctx context.Context, key string) (int64, error) {
	out, err := s.client.HeadObject(ctx, &s3.HeadObjectInput{Bucket: aws.String(s.cfg.Bucket), Key: aws.String(key)})
	if err != nil {
		return 0, mapErr(err)
	}
	return aws.ToInt64(out.ContentLength), nil
}

// Object is a streaming read.
type Object struct {
	Body io.ReadCloser
	Size int64
}

// Get opens an object for streaming. The caller closes Body.
func (s *Storage) Get(ctx context.Context, key string) (Object, error) {
	out, err := s.client.GetObject(ctx, &s3.GetObjectInput{Bucket: aws.String(s.cfg.Bucket), Key: aws.String(key)})
	if err != nil {
		return Object{}, mapErr(err)
	}
	return Object{Body: out.Body, Size: aws.ToInt64(out.ContentLength)}, nil
}

// ReadAll reads a whole object, refusing more than limit bytes.
func (s *Storage) ReadAll(ctx context.Context, key string, limit int64) ([]byte, error) {
	obj, err := s.Get(ctx, key)
	if err != nil {
		return nil, err
	}
	defer func() { _ = obj.Body.Close() }()
	data, err := io.ReadAll(io.LimitReader(obj.Body, limit+1))
	if err != nil {
		return nil, fmt.Errorf("read object: %w", err)
	}
	if int64(len(data)) > limit {
		return nil, fmt.Errorf("object %s larger than %d bytes", key, limit)
	}
	return data, nil
}

// PutJPEG writes a JPEG object (overwrites).
func (s *Storage) PutJPEG(ctx context.Context, key string, data []byte) error {
	_, err := s.client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:        aws.String(s.cfg.Bucket),
		Key:           aws.String(key),
		Body:          bytes.NewReader(data),
		ContentLength: aws.Int64(int64(len(data))),
		ContentType:   aws.String("image/jpeg"),
	})
	return mapErr(err)
}

// Delete removes one object (missing objects are fine).
func (s *Storage) Delete(ctx context.Context, key string) error {
	_, err := s.client.DeleteObject(ctx, &s3.DeleteObjectInput{Bucket: aws.String(s.cfg.Bucket), Key: aws.String(key)})
	if err = mapErr(err); errors.Is(err, ErrNotFound) {
		return nil
	}
	return err
}

// DeletePrefix removes every object under prefix.
func (s *Storage) DeletePrefix(ctx context.Context, prefix string) error {
	if prefix == "" || !strings.HasSuffix(prefix, "/") {
		return fmt.Errorf("refusing to delete prefix %q", prefix)
	}
	p := s3.NewListObjectsV2Paginator(s.client, &s3.ListObjectsV2Input{Bucket: aws.String(s.cfg.Bucket), Prefix: aws.String(prefix)})
	for p.HasMorePages() {
		page, err := p.NextPage(ctx)
		if err != nil {
			return mapErr(err)
		}
		if len(page.Contents) == 0 {
			continue
		}
		ids := make([]types.ObjectIdentifier, 0, len(page.Contents))
		for _, o := range page.Contents {
			ids = append(ids, types.ObjectIdentifier{Key: o.Key})
		}
		out, err := s.client.DeleteObjects(ctx, &s3.DeleteObjectsInput{
			Bucket: aws.String(s.cfg.Bucket),
			Delete: &types.Delete{Objects: ids, Quiet: aws.Bool(true)},
		})
		if err != nil {
			return mapErr(err)
		}
		if len(out.Errors) > 0 {
			return fmt.Errorf("delete objects: %d errors, first %s", len(out.Errors), aws.ToString(out.Errors[0].Code))
		}
	}
	return nil
}

// Ping checks the bucket is reachable with our credentials.
func (s *Storage) Ping(ctx context.Context) error {
	_, err := s.client.HeadBucket(ctx, &s3.HeadBucketInput{Bucket: aws.String(s.cfg.Bucket)})
	return mapErr(err)
}

func mapErr(err error) error {
	if err == nil {
		return nil
	}
	var nf *types.NotFound
	var nsk *types.NoSuchKey
	if errors.As(err, &nf) || errors.As(err, &nsk) {
		return fmt.Errorf("%w: %w", ErrNotFound, err)
	}
	var apiErr smithy.APIError
	if errors.As(err, &apiErr) && (apiErr.ErrorCode() == "NotFound" || apiErr.ErrorCode() == "NoSuchKey") {
		return fmt.Errorf("%w: %w", ErrNotFound, err)
	}
	return err
}
