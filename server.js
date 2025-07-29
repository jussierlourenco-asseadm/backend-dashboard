const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');

// =================================================================
// CONFIGURAÇÕES
// =================================================================
const app = express();
app.use(cors());
const PORT = process.env.PORT || 3001;
const SPREADSHEET_ID = '11uYaOh6jJDsyNm1OPKnC_MpMcA9FL2aXWKPjeMlkhW4';

const auth = new google.auth.GoogleAuth({
  keyFile: 'credenciais.json',
  scopes: 'https://www.googleapis.com/auth/spreadsheets.readonly',
});

let cachedData = null;

async function getSheetData() {
    if (cachedData) {
        console.log("Usando dados do cache.");
        return cachedData;
    }
    
    try {
        console.log("Buscando dados da planilha...");
        const sheets = google.sheets({ version: 'v4', auth });

        // CORREÇÃO: Duas chamadas para obter o melhor de ambos os mundos.
        // CHAMADA 1: Obtém os valores formatados (visíveis), ideal para textos, datas, e resultados de fórmulas como ANO() e MÊS().
        const formattedResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'BD_CHAM!A:AF',
            valueRenderOption: 'FORMATTED_VALUE' 
        });

        // CHAMADA 2: Obtém os valores numéricos brutos, ideal para colunas de moeda/cálculo.
        const unformattedResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'BD_CHAM!A:AF',
            valueRenderOption: 'UNFORMATTED_VALUE'
        });
        
        const formattedRows = formattedResponse.data.values;
        const unformattedRows = unformattedResponse.data.values;

        if (!formattedRows || formattedRows.length < 2) return [];

        const header = formattedRows[0].map(h => h ? h.trim() : `UNKNOWN_COLUMN_${Math.random()}`);
        
        const data = formattedRows.slice(1).map((formattedRow, index) => {
            const unformattedRow = unformattedRows[index + 1] || [];
            let obj = {};
            
            header.forEach((key, i) => {
                obj[key] = formattedRow[i];
            });

            // Mapeamento explícito para garantir consistência.
            obj['Número do Chamado'] = formattedRow[1]; // Coluna B
            obj['De'] = formattedRow[4];               // Coluna E (Departamento)
            obj['Tópico de ajuda'] = formattedRow[8];    // Coluna I (Serviço)
            
            // Usa o valor formatado (visível) para os filtros.
            obj['Mes'] = formattedRow[28];             // Coluna AC (índice 28)
            obj['Ano'] = formattedRow[29];             // Coluna AD (índice 29)

            // Usa o valor numérico bruto (não formatado) para o cálculo de despesa.
            obj['Custo'] = unformattedRow[31];         // Coluna AF (índice 31)

            return obj;
        });

        cachedData = data;
        setTimeout(() => { 
            console.log("Limpando cache de dados.");
            cachedData = null; 
        }, 300000); 

        return data;
    } catch (error) {
        console.error("Erro fatal ao buscar dados da planilha:", error.message);
        return []; 
    }
}


// Função auxiliar para filtrar dados
function filterData(data, query) {
    let filteredData = [...data];
    const { categoria, departamento, status, ano, mes } = query;
    
    if (categoria) filteredData = filteredData.filter(r => r['Tópico de ajuda'] === categoria);
    if (departamento) filteredData = filteredData.filter(r => r['De'] === departamento);
    if (status) filteredData = filteredData.filter(r => r['Status Atual'] === status);

    // Agora o filtro de ano e mês funciona com os valores de texto visíveis na planilha.
    if (ano) {
        filteredData = filteredData.filter(r => r.Ano == ano);
    }
    if (mes) {
        filteredData = filteredData.filter(r => r.Mes == mes);
    }

    return filteredData;
}


// =================================================================
// ROTA PARA DADOS AGREGADOS (GRÁFICOS E KPIS)
// =================================================================
app.get('/api/dashboard-data', async (req, res) => {
    let allData = await getSheetData();
    let filteredData = filterData(allData, req.query);

    // --- KPIs ---
    const totalChamados = filteredData.length;
    const aFazer = filteredData.filter(r => r['Status Atual']?.toUpperCase() === 'A FAZER').length;
    const concluidos = filteredData.filter(r => r['Status Atual']?.toUpperCase().startsWith('CONCLU')).length;

    // --- Dados para Gráficos ---
    const groupBy = (key, dataSet) => dataSet.reduce((acc, row) => {
        const group = row[key];
        if (group) acc[group] = (acc[group] || 0) + 1;
        return acc;
    }, {});

    const porStatus = groupBy('Status Atual', filteredData);
    const porCategoria = groupBy('Tópico de ajuda', filteredData);
    const porSolicitante = groupBy('De', filteredData);

    // --- Cálculo do Tempo Médio ---
    const categoryData = {};
    filteredData.forEach(row => {
        const cat = row['Tópico de ajuda'];
        const nomeDaColunaDeTempo = 'Tempo de Conclusão'; 
        const tempo = parseFloat(row[nomeDaColunaDeTempo]) || 0; 
        if (cat && tempo > 0) {
            if (!categoryData[cat]) categoryData[cat] = { sum: 0, count: 0 };
            categoryData[cat].sum += tempo;
            categoryData[cat].count++;
        }
    });

    const tempoMedio = {};
    for (const cat in categoryData) {
        tempoMedio[cat] = parseFloat((categoryData[cat].sum / categoryData[cat].count).toFixed(2));
    }

    // --- Lógica de cálculo de despesas ---
    const despesasPorDepartamento = {};
    const despesasPorServico = {};
    let totalDespesas = 0; // <<<<<<<<<<<<<<<<<<<< ADICIONADO AQUI

    filteredData.forEach(row => {
        const departamento = row['De'];
        const servico = row['Tópico de ajuda'];
        const custo = parseFloat(row['Custo']) || 0;

        if (custo > 0) {
            if (departamento) {
                despesasPorDepartamento[departamento] = (despesasPorDepartamento[departamento] || 0) + custo;
            }
            if (servico) {
                despesasPorServico[servico] = (despesasPorServico[servico] || 0) + custo;
            }
            totalDespesas += custo; // <<<<<<<<<<<<<<<<<<<< ADICIONADO AQUI
        }
    });

    // Arredonda os valores finais para 2 casas decimais.
    for (const key in despesasPorDepartamento) {
        despesasPorDepartamento[key] = parseFloat(despesasPorDepartamento[key].toFixed(2));
    }
    for (const key in despesasPorServico) {
        despesasPorServico[key] = parseFloat(despesasPorServico[key].toFixed(2));
    }
    
    // --- Opções de Filtro Dinâmicas ---
    const getOptionsFrom = (dataSet, key) => [...new Set(dataSet.map(row => row[key]).filter(Boolean))];

    const opcoesFiltro = {
        categoria: getOptionsFrom(allData, 'Tópico de ajuda'),
        departamento: getOptionsFrom(allData, 'De'),
        status: getOptionsFrom(allData, 'Status Atual'),
        ano: [...new Set(allData.map(row => row.Ano).filter(Boolean))].sort((a, b) => b - a),
    };

    // Resposta da API com os novos dados de despesa
    res.json({
        kpis: { 
            total: totalChamados, 
            aFazer, 
            concluidos,
            totalDespesas: parseFloat(totalDespesas.toFixed(2)) // <<<<<<<<<<<< ADICIONADO AQUI
        },
        graficos: { 
            porStatus, 
            porCategoria, 
            porSolicitante, 
            tempoMedio,
            despesasPorDepartamento,
            despesasPorServico
        },
        opcoesFiltro,
    });
});


// =================================================================
// ROTA PARA DADOS DETALHADOS (TABELA) - (inalterado)
// =================================================================
app.get('/api/chamados', async (req, res) => {
    let allData = await getSheetData();
    let filteredData = filterData(allData, req.query);

    const tableData = filteredData.map(row => ({
        Numero: row['Número do Chamado'],
        Departamento: row['De'],
        Serviço: row['Tópico de ajuda'] 
    }));
    
    res.json(tableData);
});


// =================================================================
// LIGANDO O SERVIDOR - (inalterado)
// =================================================================
app.listen(PORT, () => {
    console.log(`✅ Servidor rodando na porta ${PORT}`);
});
