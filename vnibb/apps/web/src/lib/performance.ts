/**
 * Performance Monitoring Utility
 * 
 * Tracks API call durations and logs slow requests.
 */

const SLOW_REQUEST_THRESHOLD_MS = 2000;

export const performanceMonitor = {
    /**
     * Measure a function execution time
     */
    async measure<T>(name: string, fn: () => Promise<T>): Promise<T> {
        const start = performance.now();
        try {
            const result = await fn();
            const duration = performance.now() - start;
            
            if (duration > SLOW_REQUEST_THRESHOLD_MS) {
                console.warn(`[Performance] Slow operation: ${name} took ${Math.round(duration)}ms`);
            } else {
                console.debug(`[Performance] ${name} took ${Math.round(duration)}ms`);
            }
            
            return result;
        } catch (error) {
            const duration = performance.now() - start;
            console.error(`[Performance] ${name} failed after ${Math.round(duration)}ms`);
            throw error;
        }
    }
};
