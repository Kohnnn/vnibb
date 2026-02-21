"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WidgetEmpty, WidgetError, WidgetLoading } from "@/components/ui/widget-states";
import { WidgetMeta } from "@/components/ui/WidgetMeta";
import {
    API_BASE_URL,
    getAdminDataHealth,
    triggerAdminDataHealthAutoBackfill,
    type AdminDataHealthResponse,
} from "@/lib/api";
import {
    Loader2, RefreshCw, Database, Search,
    ChevronLeft, ChevronRight, FileJson, Download, Terminal,
    Code, Table as TableIcon, X, ShieldAlert
} from "lucide-react";

interface TableInfo {
    name: string;
    count: number;
    last_updated: string | null;
    freshness: "fresh" | "recent" | "stale" | "unknown";
}

interface DatabaseBrowserWidgetProps {
    config?: {
        defaultTable?: string;
    };
}

export function DatabaseBrowserWidget({ config }: DatabaseBrowserWidgetProps) {
    const [selectedTable, setSelectedTable] = useState<string>(config?.defaultTable || "");
    const [page, setPage] = useState(1);
    const [search, setSearch] = useState("");
    const [debouncedSearch, setDebouncedSearch] = useState("");
    const [limit] = useState(50);
    const [sqlQuery, setSqlQuery] = useState("SELECT * FROM stocks LIMIT 10");
    const [selectedRow, setSelectedRow] = useState<any>(null);
    const [activeTab, setActiveTab] = useState("browser");
    const [healthThresholdDays, setHealthThresholdDays] = useState(7);
    
    // Debounce search
    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(search), 500);
        return () => clearTimeout(timer);
    }, [search]);

    // Reset page when table or search changes
    useEffect(() => {
        setPage(1);
    }, [selectedTable, debouncedSearch]);

    // Fetch all tables with stats
    const {
        data: tablesData,
        isLoading: tablesLoading,
        error: tablesError,
        refetch: refetchTables,
        isFetching: tablesFetching,
        dataUpdatedAt: tablesUpdatedAt,
    } = useQuery({
        queryKey: ["database-tables"],
        queryFn: async () => {
            const res = await fetch(`${API_BASE_URL}/admin/database/tables`);
            if (!res.ok) throw new Error("Failed to fetch tables");
            return res.json();
        },
        refetchInterval: 60000,
    });

    const tables: TableInfo[] = tablesData?.tables || [];

    const {
        data: dataHealth,
        isLoading: dataHealthLoading,
        error: dataHealthError,
        refetch: refetchDataHealth,
        isFetching: dataHealthFetching,
    } = useQuery<AdminDataHealthResponse>({
        queryKey: ["admin-data-health"],
        queryFn: () => getAdminDataHealth(),
        refetchInterval: 60000,
        enabled: activeTab === "health",
    });

    const autoBackfillMutation = useMutation({
        mutationFn: (dryRun: boolean) => triggerAdminDataHealthAutoBackfill({
            daysStale: healthThresholdDays,
            limitSymbols: 50,
            dryRun,
        }),
        onSuccess: () => {
            refetchDataHealth();
            refetchTables();
        },
    });

    // Fetch table data
    const { data: tableData, isLoading: tableLoading, error: tableError, refetch: refetchTableData } = useQuery({
        queryKey: ["database-table-data", selectedTable, page, debouncedSearch],
        queryFn: async () => {
            if (!selectedTable) return null;
            const offset = (page - 1) * limit;
            let url = `${API_BASE_URL}/admin/database/table/${selectedTable}/sample?limit=${limit}&offset=${offset}`;
            if (debouncedSearch) url += `&search=${encodeURIComponent(debouncedSearch)}`;
            
            const res = await fetch(url);
            if (!res.ok) throw new Error("Failed to fetch table data");
            return res.json();
        },
        enabled: !!selectedTable && activeTab === "browser",
    });

    // Fetch table schema
    const { data: schemaData, isLoading: schemaLoading, error: schemaError, refetch: refetchSchema } = useQuery({
        queryKey: ["database-table-schema", selectedTable],
        queryFn: async () => {
            if (!selectedTable) return null;
            const res = await fetch(`${API_BASE_URL}/admin/database/table/${selectedTable}/schema`);
            if (!res.ok) throw new Error("Failed to fetch schema");
            return res.json();
        },
        enabled: !!selectedTable && activeTab === "schema",
    });

    // Execute Custom Query
    const queryMutation = useMutation({
        mutationFn: async (query: string) => {
            const res = await fetch(`${API_BASE_URL}/admin/database/query`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ query }),
            });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.detail || "Query failed");
            }
            return res.json();
        }
    });

    // Set default table
    useEffect(() => {
        if (tables && tables.length > 0 && !selectedTable) {
            setSelectedTable(tables[0].name);
        }
    }, [tables, selectedTable]);

    const handleExport = (format: 'csv' | 'json') => {
        if (!tableData?.rows) return;
        
        const data = tableData.rows;
        let blob: Blob;
        let filename = `${selectedTable}_export_${new Date().toISOString()}`;

        if (format === 'json') {
            blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            filename += '.json';
        } else {
            const headers = Object.keys(data[0]).join(',');
            const rows = data.map((row: any) => 
                Object.values(row).map(val => `"${String(val ?? '').replace(/"/g, '""')}"`).join(',')
            ).join('\n');
            blob = new Blob([`${headers}\n${rows}`], { type: 'text/csv' });
            filename += '.csv';
        }

        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
    };

    return (
        <Card className="h-full flex flex-col border-none shadow-none bg-transparent relative">
            <CardHeader className="p-0 pb-4">
                <div className="flex items-center justify-between">
                    <CardTitle className="text-lg font-bold flex items-center gap-2">
                        <Database className="h-5 w-5 text-blue-500" />
                        Database Explorer
                    </CardTitle>
                    <div className="flex items-center gap-2">
                         <WidgetMeta
                             updatedAt={tablesUpdatedAt}
                             isFetching={tablesFetching && tables.length > 0}
                             isCached={Boolean(tablesError && tables.length > 0)}
                             note="Admin tables"
                             align="right"
                         />
                         <Select value={selectedTable} onValueChange={setSelectedTable}>
                            <SelectTrigger className="w-[200px] h-8 text-xs">
                                <SelectValue placeholder="Select table..." />
                            </SelectTrigger>
                            <SelectContent>
                                {tables?.map((table) => (
                                    <SelectItem key={table.name} value={table.name} className="text-xs">
                                        <div className="flex items-center justify-between w-full gap-4">
                                            <span>{table.name}</span>
                                            <span className="text-[10px] opacity-50">({table.count})</span>
                                        </div>
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => refetchTables()}
                        >
                            <RefreshCw className="h-4 w-4" />
                        </Button>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="p-0 flex-1 flex flex-col overflow-hidden">
                {tablesLoading ? (
                    <WidgetLoading message="Loading database tables..." />
                ) : tablesError ? (
                    <WidgetError
                        error={tablesError as Error}
                        title="Unable to load tables"
                        onRetry={() => refetchTables()}
                    />
                ) : tables.length === 0 ? (
                    <WidgetEmpty
                        message="No tables found in the database"
                        action={{ label: "Refresh", onClick: () => refetchTables() }}
                    />
                ) : (
                <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
                    <div className="flex items-center justify-between border-b border-white/5 mb-4">
                        <TabsList className="bg-transparent h-9 p-0 gap-4">
                            <TabsTrigger value="browser" className="bg-transparent data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-blue-500 rounded-none px-0 h-full text-xs font-bold uppercase tracking-wider">
                                <TableIcon className="h-3 w-3 mr-2" /> Browser
                            </TabsTrigger>
                            <TabsTrigger value="query" className="bg-transparent data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-blue-500 rounded-none px-0 h-full text-xs font-bold uppercase tracking-wider">
                                <Terminal className="h-3 w-3 mr-2" /> Query
                            </TabsTrigger>
                            <TabsTrigger value="schema" className="bg-transparent data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-blue-500 rounded-none px-0 h-full text-xs font-bold uppercase tracking-wider">
                                <Code className="h-3 w-3 mr-2" /> Schema
                            </TabsTrigger>
                            <TabsTrigger value="health" className="bg-transparent data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-blue-500 rounded-none px-0 h-full text-xs font-bold uppercase tracking-wider">
                                <ShieldAlert className="h-3 w-3 mr-2" /> Health
                            </TabsTrigger>
                        </TabsList>
                        
                        {activeTab === "browser" && (
                            <div className="flex items-center gap-2">
                                <div className="relative">
                                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                                    <Input 
                                        placeholder="Search rows..." 
                                        value={search}
                                        onChange={(e) => setSearch(e.target.value)}
                                        className="h-7 text-[10px] pl-7 w-40 bg-muted/50 border-none"
                                    />
                                </div>
                                <Button variant="outline" size="sm" className="h-7 text-[10px]" onClick={() => handleExport('csv')}>
                                    <Download className="h-3 w-3 mr-1" /> Export
                                </Button>
                            </div>
                        )}
                        {activeTab === "health" && (
                            <div className="flex items-center gap-2">
                                <Input
                                    type="number"
                                    min={1}
                                    max={90}
                                    value={healthThresholdDays}
                                    onChange={(e) => setHealthThresholdDays(Math.max(1, Math.min(90, Number(e.target.value) || 7)))}
                                    className="h-7 w-20 text-[10px]"
                                    title="Stale threshold (days)"
                                />
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-7 text-[10px]"
                                    onClick={() => autoBackfillMutation.mutate(true)}
                                    disabled={autoBackfillMutation.isPending}
                                >
                                    {autoBackfillMutation.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}
                                    Dry Run
                                </Button>
                                <Button
                                    size="sm"
                                    className="h-7 text-[10px]"
                                    onClick={() => autoBackfillMutation.mutate(false)}
                                    disabled={autoBackfillMutation.isPending}
                                >
                                    {autoBackfillMutation.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}
                                    Trigger Backfill
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7"
                                    onClick={() => refetchDataHealth()}
                                    title="Refresh health"
                                >
                                    <RefreshCw className="h-3 w-3" />
                                </Button>
                            </div>
                        )}
                    </div>

                    <TabsContent value="browser" className="flex-1 flex flex-col m-0 overflow-hidden">
                        <div className="flex-1 overflow-auto border rounded-md border-white/5 scrollbar-hide">
                            {tableLoading ? (
                                <WidgetLoading message="Loading rows..." />
                            ) : tableError ? (
                                <WidgetError
                                    error={tableError as Error}
                                    title="Failed to load table data"
                                    onRetry={() => refetchTableData()}
                                />
                            ) : !selectedTable ? (
                                <WidgetEmpty message="Select a table to view data" />
                            ) : tableData?.rows?.length > 0 ? (
                                <Table>
                                    <TableHeader className="bg-muted/30">
                                        <TableRow className="hover:bg-transparent border-white/5">
                                            {Object.keys(tableData.rows[0]).map((col) => (
                                                <TableHead key={col} className="text-[10px] font-black uppercase tracking-tighter h-8">
                                                    {col}
                                                </TableHead>
                                            ))}
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {tableData.rows.map((row: any, i: number) => (
                                            <TableRow 
                                                key={i} 
                                                className="border-white/5 hover:bg-white/5 cursor-pointer transition-colors"
                                                onClick={() => setSelectedRow(row)}
                                            >
                                                {Object.values(row).map((val: any, j: number) => (
                                                    <TableCell key={j} className="text-[10px] py-2 truncate max-w-[150px] font-mono text-muted-foreground">
                                                        {String(val ?? "-")}
                                                    </TableCell>
                                                ))}
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            ) : (
                                <WidgetEmpty
                                    message={debouncedSearch ? "No rows match your search" : "No records found"}
                                    action={debouncedSearch ? { label: "Clear search", onClick: () => setSearch("") } : undefined}
                                />
                            )}
                        </div>

                        {/* Pagination */}
                        {tableData && (
                            <div className="flex items-center justify-between py-2 px-1">
                                <div className="text-[10px] text-muted-foreground font-bold">
                                    Showing {((page - 1) * limit) + 1}-{Math.min(page * limit, tableData.total)} of {tableData.total.toLocaleString()}
                                </div>
                                <div className="flex items-center gap-1">
                                    <Button 
                                        variant="outline" 
                                        size="icon" 
                                        className="h-6 w-6" 
                                        disabled={page === 1}
                                        onClick={() => setPage(p => p - 1)}
                                    >
                                        <ChevronLeft className="h-3 w-3" />
                                    </Button>
                                    <span className="text-[10px] font-bold px-2">{page}</span>
                                    <Button 
                                        variant="outline" 
                                        size="icon" 
                                        className="h-6 w-6" 
                                        disabled={!tableData.has_more}
                                        onClick={() => setPage(p => p + 1)}
                                    >
                                        <ChevronRight className="h-3 w-3" />
                                    </Button>
                                </div>
                            </div>
                        )}
                    </TabsContent>

                    <TabsContent value="query" className="flex-1 flex flex-col m-0 gap-4 overflow-hidden">
                        <div className="flex flex-col gap-2">
                            <div className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">SQL Editor (SELECT only)</div>
                            <div className="relative border rounded-md border-white/10 bg-muted/20">
                                <textarea 
                                    className="w-full h-32 bg-transparent p-4 text-xs font-mono outline-none resize-none"
                                    value={sqlQuery}
                                    onChange={(e) => setSqlQuery(e.target.value)}
                                    spellCheck={false}
                                />
                                <Button 
                                    className="absolute bottom-2 right-2 h-7 text-[10px] font-bold uppercase bg-blue-600 hover:bg-blue-500"
                                    onClick={() => queryMutation.mutate(sqlQuery)}
                                    disabled={queryMutation.isPending}
                                >
                                    {queryMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-2" /> : <Terminal className="h-3 w-3 mr-2" />}
                                    Execute
                                </Button>
                            </div>
                        </div>

                        <div className="flex-1 overflow-hidden flex flex-col">
                             <div className="text-[10px] font-black uppercase text-muted-foreground tracking-widest mb-2">Results</div>
                             <div className="flex-1 overflow-auto border rounded-md border-white/5 scrollbar-hide">
                                {queryMutation.error ? (
                                    <WidgetError
                                        error={queryMutation.error as Error}
                                        title="Query failed"
                                        onRetry={() => queryMutation.mutate(sqlQuery)}
                                    />
                                ) : queryMutation.data?.rows ? (
                                    <Table>
                                         <TableHeader className="bg-muted/30">
                                            <TableRow className="hover:bg-transparent border-white/5">
                                                {Object.keys(queryMutation.data.rows[0]).map((col) => (
                                                    <TableHead key={col} className="text-[10px] font-black uppercase tracking-tighter h-8">
                                                        {col}
                                                    </TableHead>
                                                ))}
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {queryMutation.data.rows.map((row: any, i: number) => (
                                                <TableRow key={i} className="border-white/5">
                                                    {Object.values(row).map((val: any, j: number) => (
                                                        <TableCell key={j} className="text-[10px] py-2 truncate max-w-[150px] font-mono text-muted-foreground">
                                                            {String(val ?? "-")}
                                                        </TableCell>
                                                    ))}
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                ) : (
                                    <WidgetEmpty message="Run a query to see results" icon={<Code className="h-8 w-8 opacity-30" />} />
                                )}
                             </div>
                        </div>
                    </TabsContent>

                    <TabsContent value="schema" className="flex-1 flex flex-col m-0 overflow-hidden">
                         <div className="flex-1 overflow-auto border rounded-md border-white/5 scrollbar-hide">
                            {schemaLoading ? (
                                <WidgetLoading message="Loading schema..." />
                            ) : schemaError ? (
                                <WidgetError
                                    error={schemaError as Error}
                                    title="Failed to load schema"
                                    onRetry={() => refetchSchema()}
                                />
                            ) : !selectedTable ? (
                                <WidgetEmpty message="Select a table to view schema" />
                            ) : schemaData?.columns ? (
                                <Table>
                                    <TableHeader className="bg-muted/30">
                                        <TableRow className="hover:bg-transparent border-white/5">
                                            <TableHead className="text-[10px] font-black uppercase h-8">Column</TableHead>
                                            <TableHead className="text-[10px] font-black uppercase h-8">Type</TableHead>
                                            <TableHead className="text-[10px] font-black uppercase h-8">Null</TableHead>
                                            <TableHead className="text-[10px] font-black uppercase h-8">Default</TableHead>
                                            <TableHead className="text-[10px] font-black uppercase h-8">PK</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {schemaData.columns.map((col: any) => (
                                            <TableRow key={col.name} className="border-white/5">
                                                <TableCell className="text-xs font-bold text-blue-400">{col.name}</TableCell>
                                                <TableCell className="text-xs font-mono">{col.type}</TableCell>
                                                <TableCell className="text-xs">{col.nullable ? "YES" : "NO"}</TableCell>
                                                <TableCell className="text-xs text-muted-foreground font-mono">{String(col.default ?? "NULL")}</TableCell>
                                                <TableCell className="text-xs">{col.primary_key ? "✅" : ""}</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            ) : (
                                <WidgetEmpty message="No schema information found" />
                            )}
                         </div>
                    </TabsContent>

                    <TabsContent value="health" className="flex-1 flex flex-col m-0 overflow-hidden">
                        <div className="flex-1 overflow-auto border rounded-md border-white/5 p-3 space-y-3">
                            {dataHealthLoading ? (
                                <WidgetLoading message="Loading health summary..." />
                            ) : dataHealthError ? (
                                <WidgetError
                                    error={dataHealthError as Error}
                                    title="Failed to load data health"
                                    onRetry={() => refetchDataHealth()}
                                />
                            ) : !dataHealth ? (
                                <WidgetEmpty message="Data health summary is unavailable" />
                            ) : (
                                <>
                                    <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                                        {[
                                            { key: "fresh", label: "Fresh" },
                                            { key: "recent", label: "Recent" },
                                            { key: "stale", label: "Stale" },
                                            { key: "critical", label: "Critical" },
                                            { key: "unknown", label: "Unknown" },
                                        ].map((item) => (
                                            <div key={item.key} className="rounded border border-white/10 bg-muted/20 p-2">
                                                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{item.label}</div>
                                                <div className="mt-1 text-lg font-black">
                                                    {dataHealth.summary?.[item.key as keyof typeof dataHealth.summary] ?? 0}
                                                </div>
                                            </div>
                                        ))}
                                    </div>

                                    <div className="rounded border border-white/10 overflow-hidden">
                                        <Table>
                                            <TableHeader className="bg-muted/30">
                                                <TableRow className="hover:bg-transparent border-white/5">
                                                    <TableHead className="text-[10px] font-black uppercase h-8">Table</TableHead>
                                                    <TableHead className="text-[10px] font-black uppercase h-8 text-right">Rows</TableHead>
                                                    <TableHead className="text-[10px] font-black uppercase h-8 text-right">Age (days)</TableHead>
                                                    <TableHead className="text-[10px] font-black uppercase h-8">Freshness</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {Object.entries(dataHealth.tables)
                                                    .sort((a, b) => {
                                                        const ageA = a[1]?.age_days ?? -1;
                                                        const ageB = b[1]?.age_days ?? -1;
                                                        return ageB - ageA;
                                                    })
                                                    .slice(0, 20)
                                                    .map(([tableName, meta]) => (
                                                        <TableRow key={tableName} className="border-white/5">
                                                            <TableCell className="text-xs font-bold text-blue-400">{tableName}</TableCell>
                                                            <TableCell className="text-xs text-right font-mono">{Number(meta.count || 0).toLocaleString()}</TableCell>
                                                            <TableCell className="text-xs text-right font-mono">
                                                                {meta.age_days === null || meta.age_days === undefined ? "-" : meta.age_days.toFixed(2)}
                                                            </TableCell>
                                                            <TableCell className="text-xs">
                                                                <span
                                                                    className={
                                                                        meta.freshness === "critical"
                                                                            ? "text-red-400"
                                                                            : meta.freshness === "stale"
                                                                                ? "text-amber-400"
                                                                                : meta.freshness === "recent"
                                                                                    ? "text-blue-400"
                                                                                    : meta.freshness === "fresh"
                                                                                        ? "text-green-400"
                                                                                        : "text-muted-foreground"
                                                                    }
                                                                >
                                                                    {meta.freshness}
                                                                </span>
                                                            </TableCell>
                                                        </TableRow>
                                                    ))}
                                            </TableBody>
                                        </Table>
                                    </div>

                                    <div className="rounded border border-white/10 bg-muted/20 p-2">
                                        <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
                                            Backfill planner
                                        </div>
                                        {autoBackfillMutation.isPending ? (
                                            <div className="text-xs text-muted-foreground flex items-center gap-2">
                                                <Loader2 className="h-3 w-3 animate-spin" />
                                                Preparing backfill jobs...
                                            </div>
                                        ) : autoBackfillMutation.error ? (
                                            <WidgetError
                                                error={autoBackfillMutation.error as Error}
                                                title="Backfill trigger failed"
                                                onRetry={() => autoBackfillMutation.mutate(true)}
                                            />
                                        ) : autoBackfillMutation.data ? (
                                            <div className="space-y-1">
                                                <div className="text-xs text-muted-foreground">
                                                    {autoBackfillMutation.data.dry_run ? "Dry run" : "Triggered"} jobs:
                                                    {" "}{autoBackfillMutation.data.jobs.length}
                                                    {autoBackfillMutation.data.dry_run
                                                        ? " (planned)"
                                                        : ` (${autoBackfillMutation.data.jobs_scheduled} scheduled)`}
                                                </div>
                                                <div className="text-[11px] text-primary">
                                                    {autoBackfillMutation.data.jobs.map((job) => job.job).join(", ") || "No jobs selected"}
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="text-xs text-muted-foreground">
                                                Run a dry-run or trigger action to create recovery jobs for stale tables.
                                            </div>
                                        )}
                                    </div>

                                    <WidgetMeta
                                        updatedAt={Date.parse(dataHealth.timestamp)}
                                        isFetching={dataHealthFetching}
                                        note="Auto refresh 60s"
                                        align="right"
                                    />
                                </>
                            )}
                        </div>
                    </TabsContent>
                </Tabs>
                )}
            </CardContent>

            {/* Row Detail View (Overlay) */}
            {selectedRow && (
                <div className="absolute inset-0 bg-background/95 backdrop-blur-sm z-[150] flex flex-col p-6 animate-in fade-in duration-200">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                            <FileJson className="h-5 w-5 text-blue-500" />
                            <h3 className="font-bold text-lg">Row Inspector: {selectedTable}</h3>
                        </div>
                        <Button variant="ghost" size="icon" onClick={() => setSelectedRow(null)}>
                            <X className="h-5 w-5" />
                        </Button>
                    </div>
                    <div className="flex-1 overflow-auto bg-black/50 rounded-lg border border-white/10">
                        <pre className="p-4 font-mono text-xs leading-relaxed text-blue-100">
                            {JSON.stringify(selectedRow, null, 2)}
                        </pre>
                    </div>
                    <div className="flex justify-end gap-3 mt-6">
                        <Button variant="outline" size="sm" onClick={() => {
                            const blob = new Blob([JSON.stringify(selectedRow, null, 2)], { type: 'application/json' });
                            const url = window.URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = `row_${new Date().getTime()}.json`;
                            a.click();
                        }}>
                            <Download className="h-4 w-4 mr-2" /> Download JSON
                        </Button>
                        <Button onClick={() => setSelectedRow(null)}>Close Inspector</Button>
                    </div>
                </div>
            )}
        </Card>
    );
}
