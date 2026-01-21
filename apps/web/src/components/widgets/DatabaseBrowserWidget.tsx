"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
    Loader2, RefreshCw, Database, AlertCircle, Search, 
    ChevronLeft, ChevronRight, FileJson, Download, Terminal, 
    Code, Info, Table as TableIcon, X
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
    
    const queryClient = useQueryClient();

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
    const { data: tablesData, isLoading: tablesLoading } = useQuery({
        queryKey: ["database-tables"],
        queryFn: async () => {
            const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/v1/admin/database/tables`);
            if (!res.ok) throw new Error("Failed to fetch tables");
            return res.json();
        },
        refetchInterval: 60000,
    });

    const tables: TableInfo[] = tablesData?.tables || [];

    // Fetch table data
    const { data: tableData, isLoading: tableLoading } = useQuery({
        queryKey: ["database-table-data", selectedTable, page, debouncedSearch],
        queryFn: async () => {
            if (!selectedTable) return null;
            const offset = (page - 1) * limit;
            let url = `${process.env.NEXT_PUBLIC_API_URL}/api/v1/admin/database/table/${selectedTable}/sample?limit=${limit}&offset=${offset}`;
            if (debouncedSearch) url += `&search=${encodeURIComponent(debouncedSearch)}`;
            
            const res = await fetch(url);
            if (!res.ok) throw new Error("Failed to fetch table data");
            return res.json();
        },
        enabled: !!selectedTable && activeTab === "browser",
    });

    // Fetch table schema
    const { data: schemaData, isLoading: schemaLoading } = useQuery({
        queryKey: ["database-table-schema", selectedTable],
        queryFn: async () => {
            if (!selectedTable) return null;
            const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/v1/admin/database/table/${selectedTable}/schema`);
            if (!res.ok) throw new Error("Failed to fetch schema");
            return res.json();
        },
        enabled: !!selectedTable && activeTab === "schema",
    });

    // Execute Custom Query
    const queryMutation = useMutation({
        mutationFn: async (query: string) => {
            const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/v1/admin/database/query`, {
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
                            onClick={() => queryClient.invalidateQueries({ queryKey: ["database-tables"] })}
                        >
                            <RefreshCw className="h-4 w-4" />
                        </Button>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="p-0 flex-1 flex flex-col overflow-hidden">
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
                    </div>

                    <TabsContent value="browser" className="flex-1 flex flex-col m-0 overflow-hidden">
                        <div className="flex-1 overflow-auto border rounded-md border-white/5 scrollbar-hide">
                            {tableLoading ? (
                                <div className="flex items-center justify-center h-full">
                                    <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
                                </div>
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
                                <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                                    <Info className="h-8 w-8 mb-2 opacity-20" />
                                    <p className="text-sm font-bold opacity-50">No records found</p>
                                </div>
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
                                    <div className="p-4 text-red-400 text-xs font-mono whitespace-pre-wrap">
                                        Error: {(queryMutation.error as Error).message}
                                    </div>
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
                                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                                        <Code className="h-8 w-8 mb-2 opacity-20" />
                                        <p className="text-sm font-bold opacity-30">Run a query to see results</p>
                                    </div>
                                )}
                             </div>
                        </div>
                    </TabsContent>

                    <TabsContent value="schema" className="flex-1 flex flex-col m-0 overflow-hidden">
                         <div className="flex-1 overflow-auto border rounded-md border-white/5 scrollbar-hide">
                            {schemaLoading ? (
                                <div className="flex items-center justify-center h-full">
                                    <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
                                </div>
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
                            ) : null}
                         </div>
                    </TabsContent>
                </Tabs>
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
