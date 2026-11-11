import type { SoundEffects } from '../../shell/sound';
export const caissesEffects: SoundEffects = {
    move: () => ({ frequency: 310, duration: .04, type: 'sine' }),
    push: () => ({ frequency: 180, duration: .09, type: 'triangle' }),
    undo: () => ({ frequency: 450, duration: .06, type: 'sine' }),
    won: () => ({ frequency: 990, duration: .4, type: 'triangle' }),
    lost: () => ({ frequency: 120, duration: .35, type: 'sawtooth' }),
    slide: () => ({ frequency: 720, duration: .12, type: 'sine' }),
    fall: () => ({ frequency: 95, duration: .25, type: 'triangle' }),
    teleport: () => ({ frequency: 1240, duration: .14, type: 'sine' }),
};
