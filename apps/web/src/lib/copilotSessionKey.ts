/** Identity used to restore and persist the widget/ticker/tab conversation. */
export function normalizeTabKey(tabName?: string): string {
    if (!tabName) return 'overview';
    const key = tabName.toLowerCase();
    if (key.includes('financial')) return 'financials';
    if (key.includes('comparison')) return 'comparison';
    if (key.includes('technical')) return 'technical';
    if (key.includes('overview')) return 'overview';
    return 'overview';
}

export function normalizeWidgetKey(widgetName?: string): string | null {
    if (!widgetName) return null;
    const key = widgetName.toLowerCase();
    if (key.includes('comparison')) return 'comparison';
    if (key.includes('price chart') || key.includes('chart')) return 'price_chart';
    if (key.includes('foreign')) return 'foreign_trading';
    if (key.includes('breadth') || key.includes('sector performance')) return 'market_breadth';
    if (key.includes('financial') || key.includes('income') || key.includes('balance') || key.includes('cash flow') || key.includes('ratio')) return 'financials';
    return null;
}

export function getSessionKey(symbol: string, widgetContext?: string, activeTabName?: string): string {
    const widgetKey = normalizeWidgetKey(widgetContext) || 'general';
    const tabKey = normalizeTabKey(activeTabName);
    return `vnibb:copilot:session:${symbol || 'UNKNOWN'}:${widgetKey}:${tabKey}`;
}