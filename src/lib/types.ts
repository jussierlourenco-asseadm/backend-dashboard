export type ChamadoStatus = 'Aberto' | 'Em Andamento' | 'Fechado';

export type Chamado = {
  id: string;
  servico: string;
  departamento: string;
  status: ChamadoStatus;
  ano: number;
  mes: string;
  valorTotalServicos: number;
  tempoMedioConclusao: number | null;
};
