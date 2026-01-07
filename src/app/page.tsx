'use client'

import React, { useState, useMemo } from 'react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
} from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Logo } from "@/components/logo"
import type { Chamado } from "@/lib/types"
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Column, PieChart, Pie, Cell, LineChart, Line } from 'recharts';
import { useCollection, useFirestore, useMemoFirebase } from '@/firebase';
import { collection, query, where } from 'firebase/firestore';
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { AlertTriangle } from 'lucide-react'


// Helper para converter Firebase Timestamp para JS Date, se necessário
const toDate = (timestamp: any): Date | null => {
  if (timestamp && typeof timestamp.toDate === 'function') {
    return timestamp.toDate();
  }
  return null;
};

// --- COMPONENTES FILHOS (AJUSTADOS) ---

function StatusBadge({ status }: { status: any }) {
  const badgeVariant: { [key: string]: "default" | "destructive" | "outline" | "secondary" } = {
    'CONCLUÍDO': 'secondary',
    'A FAZER': 'default',
    // Adicione outros status e suas cores aqui
  };
  return <Badge variant={badgeVariant[status] || 'default'}>{status}</Badge>;
}

const Filters = ({ allChamados, onFilterChange }: any) => {
  const { services, departments, statuses, years, months } = useMemo(() => {
    if (!allChamados) return { services: [], departments: [], statuses: [], years: [], months: [] };
    
    const chamadosComData = allChamados.map((c: any) => ({
      ...c,
      jsDate: toDate(c.dataAbertura)
    }));
    
    const services = [...new Set(chamadosComData.map((c: any) => c.servico).filter(Boolean))];
    const departments = [...new Set(chamadosComData.map((c: any) => c.departamento).filter(Boolean))];
    const statuses = [...new Set(chamadosComData.map((c: any) => c.status).filter(Boolean))];
    const years = [...new Set(chamadosComData.filter((c: any) => c.jsDate && c.jsDate.getFullYear()).map((c: any) => c.jsDate.getFullYear().toString()))].sort((a,b) => parseInt(b) - parseInt(a));
    const months = [...new Set(chamadosComData.filter((c: any) => c.jsDate).map((c: any) => (c.jsDate.getMonth() + 1).toString()))].sort((a,b) => parseInt(a) - parseInt(b));

    return { services, departments, statuses, years, months };
  }, [allChamados]);

  const [localFilters, setLocalFilters] = useState({
    servico: 'all',
    departamento: 'all',
    status: 'all',
    ano: 'all',
    mes: 'all',
  });

  React.useEffect(() => {
    onFilterChange(localFilters);
  }, [localFilters, onFilterChange]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Filtros</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap items-end gap-4">
        <div className="grid w-[180px] gap-1.5">
          <Label htmlFor="servico">Serviço</Label>
          <Select value={localFilters.servico} onValueChange={(value) => setLocalFilters(f => ({...f, servico: value}))}>
            <SelectTrigger id="servico"><SelectValue placeholder="Serviço" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              {services.map((s: any) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="grid w-[180px] gap-1.5">
          <Label htmlFor="departamento">Departamento</Label>
          <Select value={localFilters.departamento} onValueChange={(value) => setLocalFilters(f => ({...f, departamento: value}))}>
            <SelectTrigger id="departamento"><SelectValue placeholder="Departamento" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              {departments.map((d: any) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="grid w-[180px] gap-1.5">
          <Label htmlFor="status">Status</Label>
          <Select value={localFilters.status} onValueChange={(value) => setLocalFilters(f => ({...f, status: value}))}>
            <SelectTrigger id="status"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              {statuses.map((s: any) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="grid w-[120px] gap-1.5">
          <Label htmlFor="ano">Ano</Label>
          <Select value={localFilters.ano} onValueChange={(value) => setLocalFilters(f => ({...f, ano: value}))}>
            <SelectTrigger id="ano"><SelectValue placeholder="Ano" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              {years.map((y: any) => <SelectItem key={y} value={y}>{y}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="grid w-[150px] gap-1.5">
          <Label htmlFor="mes">Mês</Label>
          <Select value={localFilters.mes} onValueChange={(value) => setLocalFilters(f => ({...f, mes: value}))}>
            <SelectTrigger id="mes"><SelectValue placeholder="Mês" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              {months.map((m: any) => <SelectItem key={m} value={m}>{new Date(2000, parseInt(m)-1).toLocaleString('pt-BR', { month: 'long' })}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  );
}

const Overview = ({ chamados, isLoading }: { chamados: any[], isLoading: boolean }) => {
    
    const { totalChamados, aFazer, concluidos, percentualAFazer, percentualConcluidos } = useMemo(() => {
        if (!chamados || chamados.length === 0) {
            return { totalChamados: 0, aFazer: 0, concluidos: 0, percentualAFazer: 0, percentualConcluidos: 0 };
        }

        const statusAbertos = ['A FAZER', 'ABERTO', 'EM ANDAMENTO'];
        const total = chamados.length;
        const numAFazer = chamados.filter(c => c.status && statusAbertos.includes(c.status.toUpperCase())).length;
        const numConcluidos = chamados.filter(c => c.status?.toUpperCase() === 'CONCLUÍDO').length;

        return {
            totalChamados: total,
            aFazer: numAFazer,
            concluidos: numConcluidos,
            percentualAFazer: total > 0 ? (numAFazer / total) * 100 : 0,
            percentualConcluidos: total > 0 ? (numConcluidos / total) * 100 : 0,
        };
    }, [chamados]);

    const statusData = useMemo(() => {
        if (!chamados) return [];
        const counts = chamados.reduce((acc, c) => {
            const status = c.status || 'Sem Status';
            acc[status] = (acc[status] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);
        return Object.entries(counts).map(([name, value]) => ({ name, value }));
    }, [chamados]);
    
    const servicosData = useMemo(() => {
        if (!chamados) return [];
        const counts = chamados.reduce((acc, c) => {
            const servico = c.servico || 'Não especificado';
            acc[servico] = (acc[servico] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);
        return Object.entries(counts).map(([name, value]) => ({ name, value }));
    }, [chamados]);

    const departamentoData = useMemo(() => {
        if (!chamados) return [];
        const counts = chamados.reduce((acc, c) => {
            const depto = c.departamento || 'Não especificado';
            acc[depto] = (acc[depto] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);
        return Object.entries(counts).map(([name, value]) => ({ name, value }));
    }, [chamados]);
    
    // NOVO: Cálculo do tempo médio de conclusão
    const tempoMedioData = useMemo(() => {
        if (!chamados) return [];
        const serviceTimes: Record<string, { total: number, count: number }> = {};
        
        chamados.forEach(c => {
            const dataAbertura = toDate(c.dataAbertura);
            const dataConclusao = toDate(c.dataConclusao);

            if (c.status === 'CONCLUÍDO' && dataAbertura && dataConclusao && c.servico) {
                const diffTime = Math.abs(dataConclusao.getTime() - dataAbertura.getTime());
                const diffDays = diffTime / (1000 * 60 * 60 * 24);

                if (!serviceTimes[c.servico]) {
                    serviceTimes[c.servico] = { total: 0, count: 0 };
                }
                serviceTimes[c.servico].total += diffDays;
                serviceTimes[c.servico].count += 1;
            }
        });

        return Object.entries(serviceTimes).map(([name, { total, count }]) => ({
            name,
            value: total / count
        }));
    }, [chamados]);

    if (isLoading) { /* Skeleton loading state remains the same */ }

    return (
      <div className="grid gap-4 md:gap-8">
        {/* Resumo cards */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Card>
                <CardHeader><CardTitle>TOTAL CHAMADOS</CardTitle></CardHeader>
                <CardContent><p className="text-4xl font-bold">{totalChamados}</p></CardContent>
            </Card>
            <Card>
                <CardHeader><CardTitle>A FAZER</CardTitle></CardHeader>
                <CardContent>
                    <div className="flex items-baseline gap-2">
                        <p className="text-4xl font-bold">{aFazer}</p>
                        <span className="text-sm text-muted-foreground">{`(${percentualAFazer.toFixed(1)}%)`}</span>
                    </div>
                </CardContent>
            </Card>
            <Card>
                <CardHeader><CardTitle>CONCLUÍDOS</CardTitle></CardHeader>
                <CardContent>
                    <div className="flex items-baseline gap-2">
                        <p className="text-4xl font-bold">{concluidos}</p>
                        <span className="text-sm text-muted-foreground">{`(${percentualConcluidos.toFixed(1)}%)`}</span>
                    </div>
                </CardContent>
            </Card>
        </div>
        
        {/* Gráficos de Coluna */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-1">
             <Card>
                 <CardHeader><CardTitle>STATUS</CardTitle></CardHeader>
                 <CardContent className="h-[250px]">
                     <ResponsiveContainer width="100%" height="100%">
                         <BarChart data={statusData}>
                             <XAxis dataKey="name" />
                             <YAxis />
                             <Tooltip />
                             <Bar dataKey="value" fill="hsl(var(--primary))" />
                         </BarChart>
                     </ResponsiveContainer>
                 </CardContent>
             </Card>
             <Card>
                 <CardHeader><CardTitle>SERVIÇOS</CardTitle></CardHeader>
                 <CardContent className="h-[250px]">
                     <ResponsiveContainer width="100%" height="100%">
                         <BarChart data={servicosData}>
                             <XAxis dataKey="name" />
                             <YAxis />
                             <Tooltip />
                             <Bar dataKey="value" fill="hsl(var(--primary))" />
                         </BarChart>
                     </ResponsiveContainer>
                 </CardContent>
             </Card>
             <Card>
                 <CardHeader><CardTitle>DEPARTAMENTO</CardTitle></CardHeader>
                 <CardContent className="h-[250px]">
                     <ResponsiveContainer width="100%" height="100%">
                         <BarChart data={departamentoData}>
                             <XAxis dataKey="name" />
                             <YAxis />
                             <Tooltip />
                             <Bar dataKey="value" fill="hsl(var(--primary))" />
                         </BarChart>
                     </ResponsiveContainer>
                 </CardContent>
             </Card>
        </div>
        
        {/* Gráfico de Tempo Médio */}
        <div className="grid gap-4 md:grid-cols-1">
             <Card>
                 <CardHeader><CardTitle>TEMPO MÉDIO DE CONCLUSÃO (DIAS)</CardTitle></CardHeader>
                 <CardContent className="h-[300px]">
                      <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={tempoMedioData}>
                              <XAxis dataKey="name" />
                              <YAxis />
                              <Tooltip formatter={(value) => `${Number(value).toFixed(1)} dias`}/>
                              <Bar dataKey="value" fill="hsl(var(--primary))" />
                          </BarChart>
                      </ResponsiveContainer>
                 </CardContent>
             </Card>
        </div>
      </div>
    )
}

const Expenses = ({ chamados, isLoading }: { chamados: any[], isLoading: boolean }) => {
    // AJUSTADO: Usa 'custo' em vez de 'valorTotalServicos'
    const { valorTotal, expensesByDept, expensesByService } = useMemo(() => {
        if (!chamados) return { valorTotal: 0, expensesByDept: [], expensesByService: [] };
        
        const totalsByDept = chamados.reduce((acc, c) => {
            if (c.custo && c.departamento) {
                acc[c.departamento] = (acc[c.departamento] || 0) + c.custo;
            }
            return acc;
        }, {} as Record<string, number>);
        
        const totalsByService = chamados.reduce((acc, c) => {
            if (c.custo && c.servico) {
                acc[c.servico] = (acc[c.servico] || 0) + c.custo;
            }
            return acc;
        }, {} as Record<string, number>);

        return {
            valorTotal: chamados.reduce((acc, c) => acc + (c.custo || 0), 0),
            expensesByDept: Object.entries(totalsByDept).map(([name, value]) => ({ name, value })),
            expensesByService: Object.entries(totalsByService).map(([name, value]) => ({ name, value }))
        };
    }, [chamados]);

    const currencyFormatter = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
    
    if (isLoading) { /* Skeleton loading state remains the same */ }

    return (
        <div className="grid gap-4 md:gap-8">
             <Card className="mb-4">
                 <CardHeader><CardTitle>CUSTO TOTAL DOS SERVIÇOS</CardTitle></CardHeader>
                 <CardContent>
                     <p className="text-4xl font-bold">{currencyFormatter(valorTotal)}</p>
                 </CardContent>
             </Card>
             <div className="grid grid-cols-1 gap-4 md:gap-8">
                 <Card>
                     <CardHeader><CardTitle>CUSTOS POR DEPARTAMENTO</CardTitle></CardHeader>
                     <CardContent className="h-[300px]">
                         <ResponsiveContainer width="100%" height="100%">
                             <BarChart data={expensesByDept}>
                                 <XAxis dataKey="name" />
                                 <YAxis tickFormatter={currencyFormatter} />
                                 <Tooltip formatter={currencyFormatter} />
                                 <Bar dataKey="value" fill="hsl(var(--accent))" />
                             </BarChart>
                         </ResponsiveContainer>
                     </CardContent>
                 </Card>
                 <Card>
                     <CardHeader><CardTitle>CUSTOS POR SERVIÇO</CardTitle></CardHeader>
                     <CardContent className="h-[300px]">
                         <ResponsiveContainer width="100%" height="100%">
                             <BarChart data={expensesByService}>
                                 <XAxis dataKey="name" />
                                 <YAxis tickFormatter={currencyFormatter} />
                                 <Tooltip formatter={currencyFormatter} />
                                 <Bar dataKey="value" fill="hsl(var(--primary))" />
                             </BarChart>
                         </ResponsiveContainer>
                     </CardContent>
                 </Card>
             </div>
        </div>
    );
};

const PaginatedTable = ({ data, isLoading }: { data: Chamado[], isLoading: boolean}) => {
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 10;
    
    const totalPages = data ? Math.ceil(data.length / itemsPerPage) : 1;
    const currentItems = data ? data.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage) : [];

    React.useEffect(() => {
        setCurrentPage(1);
    }, [data])

    return (
        <Card>
            <CardHeader>
                <CardTitle className="font-headline">Tabela de Chamados</CardTitle>
                <CardDescription>Uma lista de todos os chamados sincronizados.</CardDescription>
            </CardHeader>
            <CardContent>
                <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Número</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Serviço</TableHead>
                        <TableHead>Departamento</TableHead>
                        <TableHead>Data Abertura</TableHead>
                        <TableHead>Data Conclusão</TableHead>
                        <TableHead className="text-right">Custo</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {isLoading && Array.from({ length: itemsPerPage }).map((_, i) => (
                      <TableRow key={`skeleton-${i}`}>
                        <TableCell><Skeleton className="h-4 w-[100px]" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-[80px]" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-[120px]" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-[100px]" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-[90px]" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-[90px]" /></TableCell>
                        <TableCell className="text-right"><Skeleton className="h-4 w-[100px] float-right" /></TableCell>
                      </TableRow>
                    ))}
                    {!isLoading && currentItems.map((chamado: any) => (
                    <TableRow key={chamado.id}>
                        <TableCell className="font-medium">{chamado.id}</TableCell>
                        <TableCell><StatusBadge status={chamado.status} /></TableCell>
                        <TableCell>{chamado.servico}</TableCell>
                        <TableCell>{chamado.departamento}</TableCell>
                        <TableCell>{toDate(chamado.dataAbertura)?.toLocaleDateString('pt-BR') || 'N/A'}</TableCell>
                        <TableCell>{toDate(chamado.dataConclusao)?.toLocaleDateString('pt-BR') || 'N/A'}</TableCell>
                        <TableCell className="text-right">
                            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(chamado.custo || 0)}
                        </TableCell>
                    </TableRow>
                    ))}
                </TableBody>
                </Table>
                <div className="flex items-center justify-end space-x-2 py-4">
                    <Button variant="outline" size="sm" onClick={() => setCurrentPage(p => p - 1)} disabled={currentPage === 1 || isLoading}>Anterior</Button>
                    <span className="text-sm">Página {currentPage} de {totalPages > 0 ? totalPages : 1}</span>
                    <Button variant="outline" size="sm" onClick={() => setCurrentPage(p => p + 1)} disabled={currentPage === totalPages || totalPages === 0 || isLoading}>Próximo</Button>
                </div>
            </CardContent>
        </Card>
    )
}

const ManagementReport = ({ allChamados: rawAllChamados, isLoading: isAllChamadosLoading }: { allChamados: any[], isLoading: boolean }) => {
    const firestore = useFirestore();
    const currentYear = new Date().getFullYear().toString();
    const [selectedYear, setSelectedYear] = useState(currentYear);

    const { years } = useMemo(() => {
      if (!rawAllChamados) return { years: [] };
      const chamadosComData = rawAllChamados.map(c => ({...c, jsDate: toDate(c.dataAbertura)}));
      const years = [...new Set(chamadosComData.filter(c => c.jsDate).map(c => c.jsDate.getFullYear().toString()))].sort((a,b) => parseInt(b) - parseInt(a));
      return { years };
    }, [rawAllChamados]);
    
    // Filtra os dados brutos pelo ano selecionado ANTES de passá-los para os cálculos
    const chamados = useMemo(() => {
        if(!rawAllChamados) return [];
        return rawAllChamados.filter(c => {
            const dataAbertura = toDate(c.dataAbertura);
            return dataAbertura && dataAbertura.getFullYear().toString() === selectedYear;
        });
    }, [rawAllChamados, selectedYear]);

    const isLoading = isAllChamadosLoading;
    
    const currencyFormatter = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

    const {
        totalDemandas,
        taxaResolutividade,
        tempoMedioAtendimento,
        custoEstimado,
        distPorNatureza,
        funilStatus,
        sazonalidade,
        alertaSobrecarga
    } = useMemo(() => {
        if (!chamados || chamados.length === 0) {
            return {
                totalDemandas: 0, taxaResolutividade: 0, tempoMedioAtendimento: 0, custoEstimado: 0,
                distPorNatureza: [], funilStatus: [], sazonalidade: [], alertaSobrecarga: null
            };
        }
        
        // Mapeamento dos campos para o relatório
        const mappedChamados = chamados.map(c => ({
            id_chamado: c.id,
            data_criacao: c.dataAbertura,
            departamento_solicitante: c.departamento,
            categoria_manutencao: c.servico, // Mapeando 'servico' para 'categoria_manutencao'
            status: c.status,
            data_conclusao: c.dataConclusao,
            agente_atribuido: c.lastUpdatedBy, // Assumindo que lastUpdatedBy é o agente
            tempo_resolucao_dias: (c.dataAbertura && c.dataConclusao) ? (toDate(c.dataConclusao)!.getTime() - toDate(c.dataAbertura)!.getTime()) / (1000 * 60 * 60 * 24) : null,
            mes_referencia: toDate(c.dataAbertura) ? toDate(c.dataAbertura)!.toLocaleString('pt-BR', { month: 'long'}) : 'N/D',
            custo: c.custo,
        }));


        const total = mappedChamados.length;
        const concluidos = mappedChamados.filter(c => c.status === 'CONCLUÍDO').length;
        const taxa = total > 0 ? (concluidos / total) * 100 : 0;
        
        const tempoMedio = mappedChamados.reduce((acc, c) => acc + (c.tempo_resolucao_dias || 0), 0) / mappedChamados.filter(c => c.tempo_resolucao_dias !== null).length;

        const custo = mappedChamados.reduce((acc, c) => acc + (c.custo || 0), 0);
        
        const porNatureza = mappedChamados.reduce((acc, c) => {
            const cat = c.categoria_manutencao || 'N/A';
            acc[cat] = (acc[cat] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);
        const top5Natureza = Object.entries(porNatureza).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, value]) => ({ name, value }));

        const aFazer = total - concluidos;
        const statusFunil = [
            { name: 'Concluído', value: concluidos, color: '#22c55e' },
            { name: 'Aberto/Pendente', value: aFazer, color: '#f97316' },
        ];
        
        const porMes = mappedChamados.reduce((acc, c) => {
            const mes = c.mes_referencia || 'N/D';
            acc[mes] = (acc[mes] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);
        const mesesOrdenados = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
        const sazonalidadeData = mesesOrdenados.map(mes => ({ name: mes.charAt(0).toUpperCase() + mes.slice(1, 3), value: porMes[mes] || 0 }));
        
        const porAgente = mappedChamados.reduce((acc, c) => {
            if (c.agente_atribuido) {
                acc[c.agente_atribuido] = (acc[c.agente_atribuido] || 0) + 1;
            }
            return acc;
        }, {} as Record<string, number>);

        let alerta = null;
        for (const agente in porAgente) {
            if ((porAgente[agente] / total) > 0.4) {
                alerta = { agente, percentual: (porAgente[agente] / total) * 100 };
                break;
            }
        }

        return {
            totalDemandas: total,
            taxaResolutividade: taxa,
            tempoMedioAtendimento: tempoMedio,
            custoEstimado: custo,
            distPorNatureza: top5Natureza,
            funilStatus: statusFunil,
            sazonalidade: sazonalidadeData,
            alertaSobrecarga: alerta,
        };
    }, [chamados]);

    const handlePrint = () => {
        window.print();
    }
    
    if (isLoading) { return <div className="p-4">Carregando relatório...</div> }

    return (
        <div className="grid gap-4 md:gap-8 print:gap-2">
            <div className="flex justify-between items-center print-hidden">
                <h2 className="text-2xl font-bold">Relatório de Gestão {selectedYear}</h2>
                 <div className="flex items-center gap-4">
                     <div className="grid w-[120px] gap-1.5">
                         <Label htmlFor="ano-relatorio">Ano</Label>
                         <Select value={selectedYear} onValueChange={setSelectedYear}>
                             <SelectTrigger id="ano-relatorio"><SelectValue placeholder="Ano" /></SelectTrigger>
                             <SelectContent>
                                 {years.map((y: any) => <SelectItem key={y} value={y}>{y}</SelectItem>)}
                             </SelectContent>
                         </Select>
                     </div>
                    <Button onClick={handlePrint}>Exportar Relatório PDF</Button>
                </div>
            </div>
            
            {alertaSobrecarga && (
                <Alert variant="destructive" className="print-hidden">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>Alerta de Sobrecarga</AlertTitle>
                    <AlertDescription>
                        O agente <strong>{alertaSobrecarga.agente}</strong> está atribuído a mais de <strong>{alertaSobrecarga.percentual.toFixed(0)}%</strong> dos chamados, representando um risco operacional.
                    </AlertDescription>
                </Alert>
            )}

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 print:grid-cols-4">
                <Card>
                    <CardHeader><CardTitle>Total de Demandas</CardTitle></CardHeader>
                    <CardContent><p className="text-4xl font-bold">{totalDemandas}</p></CardContent>
                </Card>
                <Card>
                    <CardHeader><CardTitle>Taxa de Resolutividade</CardTitle></CardHeader>
                    <CardContent><p className="text-4xl font-bold">{taxaResolutividade.toFixed(1)}%</p></CardContent>
                </Card>
                <Card>
                    <CardHeader><CardTitle>Tempo Médio de Atendimento</CardTitle></CardHeader>
                    <CardContent><p className="text-4xl font-bold">{tempoMedioAtendimento.toFixed(1)} dias</p></CardContent>
                </Card>
                <Card>
                    <CardHeader><CardTitle>Custo Estimado</CardTitle></CardHeader>
                    <CardContent><p className="text-4xl font-bold">{currencyFormatter(custoEstimado)}</p></CardContent>
                </Card>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-8 print:grid-cols-2">
                <Card>
                    <CardHeader><CardTitle>Distribuição por Categoria (Top 5)</CardTitle></CardHeader>
                    <CardContent className="h-[300px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={distPorNatureza} layout="vertical" margin={{ left: 30 }}>
                                <XAxis type="number" hide />
                                <YAxis dataKey="name" type="category" tickLine={false} axisLine={false} />
                                <Tooltip formatter={(value) => `${value} chamados`} />
                                <Bar dataKey="value" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader><CardTitle>Funil de Status</CardTitle></CardHeader>
                    <CardContent className="h-[300px] flex items-center justify-center">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie data={funilStatus} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                                    {funilStatus.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={entry.color} />
                                    ))}
                                </Pie>
                                <Tooltip />
                            </PieChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>
            </div>
            <Card>
                <CardHeader><CardTitle>Sazonalidade de Chamados</CardTitle></CardHeader>
                <CardContent className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={sazonalidade}>
                            <XAxis dataKey="name" />
                            <YAxis />
                            <Tooltip />
                            <Line type="monotone" dataKey="value" stroke="hsl(var(--primary))" name="Chamados" />
                        </LineChart>
                    </ResponsiveContainer>
                </CardContent>
            </Card>
        </div>
    );
};


// --- COMPONENTE PRINCIPAL (AJUSTADO) ---

export default function Home() {
  const firestore = useFirestore();
  const [filters, setFilters] = useState({
    servico: 'all',
    departamento: 'all',
    status: 'all',
    ano: 'all',
    mes: 'all',
  });

  // Busca todos os chamados uma única vez para popular os filtros e para o cliente filtrar
  const { data: allChamados, isLoading } = useCollection<Chamado>(
      useMemoFirebase(() => firestore ? collection(firestore, 'chamados') : null, [firestore])
  );
  
  // Filtra os chamados no lado do cliente
  const filteredChamados = useMemo(() => {
    if (!allChamados) return [];

    return allChamados.filter(c => {
      const dataAbertura = toDate(c.dataAbertura);
      
      const servicoMatch = filters.servico === 'all' || c.servico === filters.servico;
      const deptoMatch = filters.departamento === 'all' || c.departamento === filters.departamento;
      const statusMatch = filters.status === 'all' || c.status === filters.status;
      const anoMatch = filters.ano === 'all' || (dataAbertura && dataAbertura.getFullYear().toString() === filters.ano);
      const mesMatch = filters.mes === 'all' || (dataAbertura && (dataAbertura.getMonth() + 1).toString() === filters.mes);

      return servicoMatch && deptoMatch && statusMatch && anoMatch && mesMatch;
    }).sort((a, b) => {
        const dateA = toDate(a.dataAbertura);
        const dateB = toDate(b.dataAbertura);
        if (dateA && dateB) {
            return dateB.getTime() - dateA.getTime();
        }
        return 0;
    });
  }, [allChamados, filters]);


  return (
    <div className="flex min-h-screen w-full flex-col bg-background">
      <header className="sticky top-0 flex h-24 items-center gap-4 border-b bg-card px-4 md:px-6 z-10 print-hidden">
        <nav className="flex items-center gap-2 text-lg font-medium md:text-base">
          <a href="#" className="flex items-center gap-2 text-lg font-semibold">
            <Logo className="h-full w-auto p-2" />
            <span className="sr-only">Chamados Sync</span>
          </a>
          <h1 className="font-headline text-xl font-bold tracking-tight text-foreground">
            Dashboard de Chamados
          </h1>
        </nav>
      </header>
      <main className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8">
        <Tabs defaultValue="overview" className="print-hidden">
          <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="overview">Visão Geral</TabsTrigger>
              <TabsTrigger value="table">Tabela</TabsTrigger>
              <TabsTrigger value="expenses">Despesas</TabsTrigger>
              <TabsTrigger value="management">Relatório de Gestão</TabsTrigger>
          </TabsList>
          
          <TabsContent value="overview">
            <div className="flex flex-col gap-4">
              <Filters allChamados={allChamados} onFilterChange={setFilters} />
              <Overview chamados={filteredChamados} isLoading={isLoading} />
            </div>
          </TabsContent>

          <TabsContent value="table">
             <div className="flex flex-col gap-4">
              <Filters allChamados={allChamados} onFilterChange={setFilters} />
              <PaginatedTable data={filteredChamados} isLoading={isLoading} />
            </div>
          </TabsContent>

          <TabsContent value="expenses">
            <div className="flex flex-col gap-4">
              <Filters allChamados={allChamados} onFilterChange={setFilters} />
              <Expenses chamados={filteredChamados} isLoading={isLoading} />
            </div>
          </TabsContent>

          <TabsContent value="management">
            <ManagementReport allChamados={allChamados} isLoading={isLoading} />
          </TabsContent>

        </Tabs>
         <div className="hidden print:block">
            <ManagementReport allChamados={allChamados} isLoading={isLoading} />
        </div>
      </main>
      <footer className="mt-auto border-t bg-card p-4 text-center text-sm text-muted-foreground print-hidden">
        <p>© Desenvolvido pela Assessoria de Administração do Centro de Biociências</p>
      </footer>
    </div>
  );
}
