import { markAlertActivityRead, readAlertActivity, recordAlertActivity } from './alertActivity';

describe('alert activity', () => {
    beforeEach(() => window.localStorage.clear());

    it('labels source and delivery, retains read state, and keeps last-good activity after malformed storage', () => {
        recordAlertActivity({
            id: 'price-1',
            source: 'price',
            triggerTime: '2026-08-01T10:00:00.000Z',
            deliveryClass: 'browser_local',
            serverBacked: false,
            title: 'FPT price alert triggered',
        });
        recordAlertActivity({
            id: 'insider-1',
            source: 'insider',
            triggerTime: '2026-08-01T11:00:00.000Z',
            deliveryClass: 'server_backed',
            serverBacked: true,
            title: 'Insider activity',
        });

        markAlertActivityRead('price-1');
        recordAlertActivity({
            id: 'insider-1',
            source: 'insider',
            triggerTime: '2026-08-01T11:00:00.000Z',
            deliveryClass: 'server_backed',
            serverBacked: true,
            title: 'Insider activity',
            read: true,
        });
        expect(readAlertActivity()).toEqual([
            expect.objectContaining({ id: 'insider-1', source: 'insider', deliveryClass: 'server_backed', serverBacked: true, read: true }),
            expect.objectContaining({ id: 'price-1', source: 'price', deliveryClass: 'browser_local', serverBacked: false, read: true }),
        ]);

        window.localStorage.setItem('vnibb-alert-activity-v1', '{bad json');
        expect(readAlertActivity()).toHaveLength(2);
    });
});
