import { FaceLandmarkResult, LivenessChallengeType, LivenessState } from '../types';
import { config } from '../utils/config';
// We'll update the FaceLandmarkResult type mapping later, but for now we expect these fields.

export class LivenessStateMachine {
  private state: LivenessState;
  private blinkMaxOpen = 0; // highest avg eye-open prob seen during the current BLINK challenge

  constructor() {
    this.state = this.getInitialState();
  }

  private getInitialState(): LivenessState {
    return {
      status: 'IDLE',
      currentChallenge: null,
      challengesRemaining: [],
      timeoutAt: null,
      message: 'Position your face in the oval.',
    };
  }

  public getState(): LivenessState {
    return { ...this.state };
  }

  public startChallenges(challenges: LivenessChallengeType[]): void {
    if (challenges.length === 0) return;
    
    const firstChallenge = challenges[0];
    this.blinkMaxOpen = 0;
    this.state = {
      status: 'IN_PROGRESS',
      currentChallenge: firstChallenge,
      challengesRemaining: challenges.slice(1),
      timeoutAt: Date.now() + config.liveness.challengeTimeoutMs,
      message: this.getChallengeMessage(firstChallenge),
    };
  }

  public reset(): void {
    this.blinkMaxOpen = 0;
    this.state = this.getInitialState();
  }

  public processFrame(result: FaceLandmarkResult): LivenessState {
    if (this.state.status !== 'IN_PROGRESS' || !this.state.currentChallenge) {
      return this.state;
    }

    // Check timeout
    if (this.state.timeoutAt && Date.now() > this.state.timeoutAt) {
      this.state.status = 'FAILED';
      this.state.message = 'Time out. Please try again.';
      this.state.currentChallenge = null;
      return this.state;
    }

    if (!result.hasFace) {
      this.state.message = 'No face detected. Keep device still.';
      return this.state;
    }

    // Check if current challenge is met
    const passed = this.checkChallenge(this.state.currentChallenge, result);

    if (passed) {
      if (this.state.challengesRemaining.length > 0) {
        // Move to next challenge
        const nextChallenge = this.state.challengesRemaining[0];
        this.blinkMaxOpen = 0; // reset blink baseline for the next challenge
        this.state.currentChallenge = nextChallenge;
        this.state.challengesRemaining = this.state.challengesRemaining.slice(1);
        this.state.timeoutAt = Date.now() + config.liveness.challengeTimeoutMs;
        this.state.message = `Good! Now, ${this.getChallengeMessage(nextChallenge)}`;
      } else {
        // All challenges passed
        this.state.status = 'PASSED';
        this.state.currentChallenge = null;
        this.state.message = 'Liveness verified!';
      }
    }

    return this.state;
  }

  private checkChallenge(challenge: LivenessChallengeType, result: FaceLandmarkResult): boolean {
    switch (challenge) {
      case 'BLINK': {
        // ML Kit eye-open probability drops when the eye closes. Catching a single
        // fully-closed frame is unreliable at any sane sampling rate, so we detect the
        // transition: eyes must have been clearly open (baseline), then clearly close.
        const leftOpen = result.leftEyeOpenProbability ?? 1.0;
        const rightOpen = result.rightEyeOpenProbability ?? 1.0;
        const avgOpen = (leftOpen + rightOpen) / 2;
        this.blinkMaxOpen = Math.max(this.blinkMaxOpen, avgOpen);
        const wasOpen = this.blinkMaxOpen >= config.liveness.blinkOpenBaseline;
        const nowClosing = avgOpen <= config.liveness.blinkClosedThreshold;
        return wasOpen && nowClosing;
      }
      case 'SMILE': {
        // Probability goes UP when smiling.
        const smiling = result.smilingProbability ?? 0;
        return smiling > config.liveness.smileThreshold;
      }
      case 'TURN_HEAD_LEFT': {
        // yaw is user-relative (negated from ML Kit in useFaceAuth for front camera).
        return result.yaw < -config.liveness.headTurnYawThreshold;
      }
      case 'TURN_HEAD_RIGHT': {
        return result.yaw > config.liveness.headTurnYawThreshold;
      }
      default:
        return false;
    }
  }

  private getChallengeMessage(challenge: LivenessChallengeType): string {
    switch (challenge) {
      case 'BLINK': return 'Please blink your eyes.';
      case 'SMILE': return 'Please smile.';
      case 'TURN_HEAD_LEFT': return 'Turn your head slowly to the left.';
      case 'TURN_HEAD_RIGHT': return 'Turn your head slowly to the right.';
      default: return '';
    }
  }
}
