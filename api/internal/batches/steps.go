package batches

import "github.com/nethstore/estudio/api/internal/store"

// Step states (SPEC 7.3).
const (
	StatePending   = "pending"
	StateLoading   = "loading"
	StateCompleted = "completed"
	StateError     = "error"
)

// Step is the progress of one pipeline step.
type Step struct {
	State string `json:"state"`
	Done  *int   `json:"done,omitempty"`
	Total *int   `json:"total,omitempty"`
}

// Steps is the progress of the four steps.
type Steps struct {
	Upload  Step `json:"upload"`
	Prepare Step `json:"prepare"`
	Stamp   Step `json:"stamp"`
	Ready   Step `json:"ready"`
}

// Progress is everything derived from the photo statuses.
type Progress struct {
	Steps        Steps
	FailedCount  int
	StampedCount int
	Finished     bool
}

// stage returns the index of the step a photo is in (0 upload, 1 prepare,
// 2 stamp, 3 done) and whether it failed there.
func stage(p store.Photo) (idx int, failed bool) {
	switch p.Status {
	case store.StatusAwaitingUpload:
		return 0, false
	case store.StatusUploaded:
		return 1, false
	case store.StatusPrepared:
		return 2, false
	case store.StatusStamped:
		return 3, false
	case store.StatusFailed:
		if p.FailedStep != nil {
			switch *p.FailedStep {
			case store.StepUpload:
				return 0, true
			case store.StepPrepare:
				return 1, true
			case store.StepStamp:
				return 2, true
			}
		}
		return 0, true
	}
	return 0, false
}

// ComputeProgress applies the SPEC 7.3 rules to the photos of a batch.
func ComputeProgress(photos []store.Photo) Progress {
	total := len(photos)
	var passed, inStep, failedIn [3]int
	var waitingBefore [3]int // photos still in an earlier step, not failed
	var pr Progress
	for _, p := range photos {
		idx, failed := stage(p)
		if failed {
			pr.FailedCount++
			failedIn[idx]++
		} else if idx < 3 {
			inStep[idx]++
		} else {
			pr.StampedCount++
		}
		for s := 0; s < 3; s++ {
			switch {
			case s < idx:
				passed[s]++
			case s > idx && !failed:
				waitingBefore[s]++
			}
		}
	}

	var states [3]string
	prevDone := true // the step before upload is always done
	for s := 0; s < 3; s++ {
		reached := passed[s] + inStep[s] + failedIn[s]
		switch {
		case reached == 0 && !prevDone:
			states[s] = StatePending
		case inStep[s] > 0 || waitingBefore[s] > 0:
			states[s] = StateLoading
		case failedIn[s] > 0:
			states[s] = StateError
		default:
			states[s] = StateCompleted
		}
		prevDone = states[s] == StateCompleted || states[s] == StateError
	}

	mk := func(s int) Step {
		d, t := passed[s], total
		return Step{State: states[s], Done: &d, Total: &t}
	}
	pr.Steps.Upload = mk(0)
	pr.Steps.Prepare = mk(1)
	pr.Steps.Stamp = mk(2)

	inFlight := inStep[0] + inStep[1] + inStep[2]
	pr.Finished = inFlight == 0
	switch {
	case pr.Finished && pr.StampedCount > 0:
		pr.Steps.Ready = Step{State: StateCompleted}
	case pr.Finished:
		pr.Steps.Ready = Step{State: StateError}
	default:
		pr.Steps.Ready = Step{State: StatePending}
	}
	return pr
}
