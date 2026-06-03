import { useState, useRef, useCallback } from 'react';
import { LivenessStateMachine } from './LivenessStateMachine';
import { FaceLandmarkResult, LivenessChallengeType, LivenessState } from '../types';

export function useLiveness() {
  const stateMachineRef = useRef(new LivenessStateMachine());
  const [livenessState, setLivenessState] = useState<LivenessState>(stateMachineRef.current.getState());

  const startLiveness = useCallback((challenges: LivenessChallengeType[] = ['BLINK', 'TURN_HEAD_LEFT', 'SMILE']) => {
    stateMachineRef.current.startChallenges(challenges);
    setLivenessState(stateMachineRef.current.getState());
  }, []);

  const processFrame = useCallback((result: FaceLandmarkResult) => {
    // Only update react state if the internal state machine changed status or message, to avoid excessive re-renders
    const oldState = stateMachineRef.current.getState();
    const newState = stateMachineRef.current.processFrame(result);
    
    if (
      oldState.status !== newState.status ||
      oldState.currentChallenge !== newState.currentChallenge ||
      oldState.message !== newState.message
    ) {
      setLivenessState({ ...newState });
    }
  }, []);

  const resetLiveness = useCallback(() => {
    stateMachineRef.current.reset();
    setLivenessState(stateMachineRef.current.getState());
  }, []);

  return {
    livenessState,
    startLiveness,
    processFrame,
    resetLiveness,
  };
}
