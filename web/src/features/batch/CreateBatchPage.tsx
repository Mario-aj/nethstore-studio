import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type ChangeEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { isApiError } from '../../shared/api/client';
import { api } from '../../shared/api/endpoints';
import { errorMessage, t } from '../../shared/i18n/pt-AO';
import { formatPriceInput, formatShortDate, parsePriceInput } from '../../shared/lib/format';
import { DESCRIPTION_MAX, type Size } from '../../shared/lib/stamp';
import { AppHeader, HeaderActions } from '../../shared/ui/AppHeader';
import { Banner } from '../../shared/ui/Banner';
import { Button, LinkButton } from '../../shared/ui/Button';
import { Icon, StatusIcon } from '../../shared/ui/Icon';
import { PhotoTile } from '../../shared/ui/PhotoTile';
import { addPhotos, batchFormView, MAX_PHOTOS, type LocalPhoto } from './createBatchForm';
import { SizesSheet } from './SizesSheet';
import { uploads } from './uploads';
import styles from './CreateBatchPage.module.css';

export default function CreateBatchPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const priceId = useId();
  const priceErrorId = useId();
  const descId = useId();
  const descErrorId = useId();
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const [photos, setPhotos] = useState<LocalPhoto[]>([]);
  const [price, setPrice] = useState<number | null>(null);
  const [sizes, setSizes] = useState<Size[]>([]);
  const [description, setDescription] = useState<string>(t.create.descriptionDefault);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [leftOut, setLeftOut] = useState(0);
  const [today] = useState(() => formatShortDate(new Date()));

  const showAll = location.hash === '#todas';
  const view = batchFormView({ photos: photos.length, price, sizes, description });

  // Coming from "Apagar lote": say it once, then drop the flag from the history entry
  // so a reload does not repeat it. The notice goes away when photos are picked.
  const arrivedFromDelete = (location.state as { batchDeleted?: unknown } | null)?.batchDeleted === true;
  const [batchDeleted] = useState(arrivedFromDelete);
  useEffect(() => {
    if (arrivedFromDelete) void navigate('.', { replace: true, state: null });
  }, [arrivedFromDelete, navigate]);

  // Local previews are revoked on removal and when leaving the screen (SPEC 11.3).
  const previewUrls = useRef(new Set<string>());
  useEffect(() => {
    const urls = previewUrls.current;
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls.clear();
    };
  }, []);

  const create = useMutation({
    mutationFn: () => api.createBatch(view.request()),
    onSuccess: (batch) => {
      uploads.start(
        batch,
        photos.map((photo) => photo.file),
      );
      void navigate(`/estudio/lotes/${batch.id}`);
    },
  });

  const logout = useMutation({
    mutationFn: api.logout,
    onSettled: () => {
      queryClient.clear();
      void navigate('/entrar', { replace: true });
    },
  });

  const onFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length === 0) return;
    const result = addPhotos(photos, files, (file) => {
      const url = URL.createObjectURL(file);
      previewUrls.current.add(url);
      return url;
    });
    setPhotos(result.photos);
    setLeftOut(result.leftOut);
  };

  const remove = (key: string) => {
    const photo = photos.find((p) => p.key === key);
    if (photo) {
      URL.revokeObjectURL(photo.url);
      previewUrls.current.delete(photo.url);
    }
    setPhotos(photos.filter((p) => p.key !== key));
    setLeftOut(0);
  };

  const openAll = () => void navigate({ hash: 'todas' }, { state: { fromMain: true } });
  const closeAll = () => {
    if ((location.state as { fromMain?: boolean } | null)?.fromMain) void navigate(-1);
    else void navigate({ hash: '' }, { replace: true });
  };

  const pickGallery = () => galleryRef.current?.click();
  const pickCamera = () => cameraRef.current?.click();

  const inputs = (
    <>
      <input
        ref={galleryRef}
        className={styles.hiddenInput}
        type="file"
        accept="image/*"
        multiple
        onChange={onFiles}
        aria-hidden="true"
        tabIndex={-1}
        data-testid="gallery-input"
      />
      <input
        ref={cameraRef}
        className={styles.hiddenInput}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={onFiles}
        aria-hidden="true"
        tabIndex={-1}
        data-testid="camera-input"
      />
    </>
  );

  const header = (
    <AppHeader>
      <HeaderActions>
        <LinkButton to="/estudio/lotes" variant="text" icon="stack" iconSize={18}>
          {t.batches.link}
        </LinkButton>
        <Button
          variant="iconOnly"
          aria-label={t.common.logout}
          onClick={() => logout.mutate()}
          disabled={logout.isPending}
        >
          <Icon name="logout" size={20} />
        </Button>
      </HeaderActions>
    </AppHeader>
  );

  const tooMany =
    leftOut > 0 ? (
      <Banner
        tone="error"
        icon="image"
        title={t.create.tooMany(leftOut)}
        className={styles.notice}
        role="status"
      />
    ) : null;

  if (showAll) {
    return (
      <div className={styles.page}>
        {header}
        <div className={styles.allHead}>
          <div className={styles.allBar}>
            <Button
              variant="iconOnly"
              className={styles.backButton}
              aria-label={t.common.back}
              onClick={closeAll}
            >
              <Icon name="chevronLeft" size={22} />
            </Button>
            <h1>{t.create.allTitle(photos.length)}</h1>
            <Button
              variant="outlineSmall"
              icon="plus"
              iconSize={16}
              onClick={pickGallery}
              disabled={photos.length >= MAX_PHOTOS}
            >
              {t.create.add}
            </Button>
          </div>
          <p className={styles.hint}>{t.create.allHint}</p>
        </div>
        {tooMany}
        <ul className={styles.grid} aria-label={t.create.allTitle(photos.length)}>
          {photos.map((photo, index) => (
            <li key={photo.key}>
              <PhotoTile
                src={photo.url}
                alt={t.create.photoAlt(index + 1)}
                onRemove={() => remove(photo.key)}
                removeLabel={t.create.removePhoto(index + 1)}
              />
            </li>
          ))}
        </ul>
        <footer className={styles.footer}>
          <div className={styles.footerInner}>
            <Button block onClick={closeAll}>
              {t.create.done}
            </Button>
          </div>
        </footer>
        {inputs}
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {header}
      <div className={styles.intro}>
        <p className={styles.eyebrow}>{t.create.eyebrow(today)}</p>
        <h1 className={styles.title}>{t.create.title}</h1>
      </div>

      {batchDeleted && photos.length === 0 ? (
        <Banner
          tone="success"
          icon="check"
          title={t.create.batchDeleted}
          className={styles.notice}
          role="status"
        >
          {t.create.batchDeletedHint}
        </Banner>
      ) : null}

      {photos.length === 0 ? (
        <div className={styles.empty}>
          <Icon name="image" size={36} strokeWidth={1.2} />
          <div className={styles.emptyText}>
            <p>{t.create.emptyTitle}</p>
            <p>{t.create.emptyBody}</p>
          </div>
          <div className={styles.emptyActions}>
            <Button icon="image" className={styles.emptyButton} onClick={pickGallery}>
              {t.create.choose}
            </Button>
            <Button variant="outline" icon="camera" className={styles.emptyButton} onClick={pickCamera}>
              {t.create.camera}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className={styles.strip}>
            <button
              type="button"
              className={styles.addTile}
              aria-label={t.create.addPhotos}
              onClick={pickGallery}
              disabled={photos.length >= MAX_PHOTOS}
            >
              <Icon name="plus" size={24} />
              {t.create.add}
            </button>
            {photos.map((photo, index) => (
              <img
                key={photo.key}
                className={styles.stripPhoto}
                src={photo.url}
                alt={t.create.photoAlt(index + 1)}
              />
            ))}
          </div>
          <div className={styles.countRow}>
            <span className={styles.count}>
              <strong>{photos.length}</strong> {t.create.inBatch(photos.length)}
            </span>
            <Button variant="text" iconAfter="chevronRight" iconSize={16} onClick={openAll}>
              {t.create.seeAll}
            </Button>
          </div>
        </>
      )}
      {tooMany}

      <div className={styles.card}>
        <div className={styles.priceBlock}>
          <label
            htmlFor={priceId}
            className={`${styles.label} ${view.priceMissing ? styles.labelError : ''}`}
          >
            {t.create.price}
          </label>
          <div className={styles.priceRow}>
            <input
              id={priceId}
              className={styles.priceInput}
              inputMode="numeric"
              pattern="[0-9.]*"
              autoComplete="off"
              enterKeyHint="next"
              placeholder="0"
              value={formatPriceInput(price)}
              aria-invalid={view.priceMissing || undefined}
              aria-describedby={view.priceMissing ? priceErrorId : undefined}
              onChange={(event) => setPrice(parsePriceInput(event.target.value))}
            />
            <span className={styles.currency} aria-hidden="true">
              kz
            </span>
          </div>
          {view.priceMissing ? (
            <span id={priceErrorId} className={styles.fieldError}>
              <StatusIcon kind="warn" size={16} />
              {t.create.priceMissing}
            </span>
          ) : null}
        </div>

        <button
          type="button"
          className={styles.sizesRow}
          onClick={() => setSheetOpen(true)}
          aria-haspopup="dialog"
        >
          <span className={styles.sizesText}>
            <span className={styles.label}>{t.create.sizes}</span>
            <span className={`${styles.sizesValue} ${sizes.length === 0 ? styles.placeholder : ''}`}>
              {view.sizesText}
            </span>
          </span>
          <span className={styles.chevron}>
            <Icon name="chevronRight" size={20} />
          </span>
        </button>

        <div className={styles.descBlock}>
          <div className={styles.descHead}>
            <label htmlFor={descId} className={styles.label}>
              {t.create.description}
            </label>
            <span className={styles.descCount} aria-hidden="true">
              {view.descriptionLength}/{DESCRIPTION_MAX}
            </span>
          </div>
          <input
            id={descId}
            className={styles.descInput}
            value={description}
            maxLength={DESCRIPTION_MAX}
            placeholder={t.create.descriptionPlaceholder}
            autoComplete="off"
            enterKeyHint="done"
            aria-invalid={view.descriptionError ? true : undefined}
            aria-describedby={view.descriptionError ? descErrorId : undefined}
            onChange={(event) => setDescription(event.target.value)}
          />
          {view.descriptionError ? (
            <span id={descErrorId} className={styles.fieldError}>
              <StatusIcon kind="warn" size={16} />
              {view.descriptionError}
            </span>
          ) : null}
        </div>
      </div>

      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          {create.isError ? (
            <Banner
              tone="error"
              icon="info"
              title={errorMessage(isApiError(create.error) ? create.error.code : 'unknown')}
            />
          ) : null}
          <p className={styles.stampLine}>
            {t.create.stampLabel}{' '}
            {view.stamp.empty ? (
              <span className={styles.stampValue}>{t.create.stampEmpty}</span>
            ) : (
              <>
                <span className={styles.stampValue}>
                  {view.stamp.descriptionPrefix}
                  {view.stamp.sizes ?? <span className={styles.stampMissing}>{t.create.stampNoSizes}</span>}
                </span>
                <span aria-hidden="true">·</span>
                {view.stamp.price ? (
                  <span className={styles.stampPrice}>{view.stamp.price}</span>
                ) : (
                  <span className={styles.stampMissing}>{t.create.stampNoPrice}</span>
                )}
              </>
            )}
          </p>
          <Button block disabled={!view.canProcess} busy={create.isPending} onClick={() => create.mutate()}>
            {photos.length === 0 ? t.create.process : t.create.processN(photos.length)}
          </Button>
        </div>
      </footer>

      <SizesSheet
        open={sheetOpen}
        sizes={sizes}
        description={description}
        onClose={() => setSheetOpen(false)}
        onApply={(next) => {
          setSizes(next);
          setSheetOpen(false);
        }}
      />
      {inputs}
    </div>
  );
}
