'use client';

import { useSwipeable } from 'react-swipeable';

interface TouchGesturesConfig {
    onSwipeLeft?: () => void;
    onSwipeRight?: () => void;
    onSwipeUp?: () => void;
    onSwipeDown?: () => void;
}

export function useTouchGestures(config: TouchGesturesConfig) {
    return useSwipeable({
        onSwipedLeft: config.onSwipeLeft,
        onSwipedRight: config.onSwipeRight,
        onSwipedUp: config.onSwipeUp,
        onSwipedDown: config.onSwipeDown,
        trackMouse: false, // Only track touch, not mouse
        delta: 50, // Minimum swipe distance
        preventScrollOnSwipe: false,
    });
}
