export type AlertType = 'INSIDER_BUY' | 'INSIDER_SELL' | 'BLOCK_TRADE' | 'OWNERSHIP_CHANGE';
export type AlertSeverity = 'low' | 'medium' | 'high';
export type TradeSide = 'BUY' | 'SELL';

export interface InsiderTrade {
    id: number;
    symbol: string;
    insider_name: string | null;
    insider_position: string | null;
    deal_action: string | null;
    deal_quantity: number | null;
    deal_price: number | null;
    deal_value: number | null;
    announce_date: string;
}

export interface BlockTrade {
    id: number;
    symbol: string;
    side: TradeSide;
    quantity: number;
    price: number;
    value: number;
    trade_time: string;
    volume_ratio: number | null;
    is_foreign: boolean;
    is_proprietary: boolean;
}

export interface InsiderAlert {
    id: number;
    alert_type: AlertType;
    severity: AlertSeverity;
    symbol: string;
    title: string;
    description: string;
    timestamp: string;
    read: boolean;
    read_at: string | null;
}

export interface AlertSettings {
    user_id: number;
    block_trade_threshold: number;
    enable_insider_buy_alerts: boolean;
    enable_insider_sell_alerts: boolean;
    enable_ownership_change_alerts: boolean;
    ownership_change_threshold: number;
    enable_browser_notifications: boolean;
    enable_email_notifications: boolean;
    enable_sound_alerts: boolean;
    notification_email: string | null;
}

export interface InsiderSentiment {
    symbol: string;
    period_days: number;
    buy_count: number;
    sell_count: number;
    buy_value: number;
    sell_value: number;
    net_value: number;
    sentiment_score: number;
    total_deals: number;
}
