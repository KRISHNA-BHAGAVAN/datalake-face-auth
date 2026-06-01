import { FaceLandmarkResult, LivenessChallengeType, LivenessState } from '../types';
import { config } from '../utils/config';
// We'll update the FaceLandmarkResult type mapping later, but for now we expect these fields.

export class LivenessStateMachine {
  private state: LivenessState;

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
    this.state = {
      status: 'IN_PROGRESS',
      currentChallenge: firstChallenge,
      challengesRemaining: challenges.slice(1),
      timeoutAt: Date.now() + config.liveness.challengeTimeoutMs,
      message: this.getChallengeMessage(firstChallenge),
    };
  }

  public reset(): void {
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
        // Using MLKit/expo-face-detector probabilities instead of blendshapes
        // Probability goes DOWN when the eye is closed.
        // Assuming blinkThreshold in config is meant for blendshapes (which go UP when blinking),
        // we use a threshold of < 0.3 for open probability.
        const leftOpen = result.leftEyeOpenProbability ?? 1.0;
        const rightOpen = result.rightEyeOpenProbability ?? 1.0;
        // Consider a blink if both eyes are closed
        return (leftOpen < 0.3) && (rightOpen < 0.3);
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
