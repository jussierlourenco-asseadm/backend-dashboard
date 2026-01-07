import type { Chamado } from '@/lib/types';

// This is mock data. It is no longer used now that we fetch from firestore.
export const chamados: Chamado[] = [
  {
    "id": "CH-001",
    "servico": "Desenvolvimento",
    "departamento": "TI",
    "status": "Fechado",
    "ano": 2023,
    "mes": "Outubro",
    "valorTotalServicos": 1500,
    "tempoMedioConclusao": 5
  },
  {
    "id": "CH-002",
    "servico": "Suporte Técnico",
    "departamento": "TI",
    "status": "Aberto",
    "ano": 2023,
    "mes": "Outubro",
    "valorTotalServicos": 200,
    "tempoMedioConclusao": null
  },
  {
    "id": "CH-003",
    "servico": "Design",
    "departamento": "Marketing",
    "status": "Em Andamento",
    "ano": 2023,
    "mes": "Outubro",
    "valorTotalServicos": 800,
    "tempoMedioConclusao": null
  },
  {
    "id": "CH-004",
    "servico": "Desenvolvimento",
    "departamento": "TI",
    "status": "Fechado",
    "ano": 2023,
    "mes": "Setembro",
    "valorTotalServicos": 3200,
    "tempoMedioConclusao": 12
  },
  {
    "id": "CH-005",
    "servico": "Infraestrutura",
    "departamento": "TI",
    "status": "Aberto",
    "ano": 2024,
    "mes": "Janeiro",
    "valorTotalServicos": 5000,
    "tempoMedioConclusao": null
  },
  {
    "id": "CH-006",
    "servico": "Suporte Técnico",
    "departamento": "Vendas",
    "status": "Em Andamento",
    "ano": 2024,
    "mes": "Janeiro",
    "valorTotalServicos": 250,
    "tempoMedioConclusao": null
  }
];
