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
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'BD_CHAM!A:AD', 
        });
        
        const rows = response.data.values;
        if (!rows || rows.length < 2) return [];

        const header = rows[0].map(h => h ? h.trim() : `UNKNOWN_COLUMN_${Math.random()}`);
        
        const data = rows.slice(1).map(row => {
            let obj = {};
            header.forEach((key, i) => {
                obj[key] = row[i];
            });

            // =======================================================================
            // AJUSTE CRÍTICO: Lendo colunas por POSIÇÃO e não por NOME DO CABEÇALHO
            // Isso garante que os filtros funcionem independentemente do texto do cabeçalho.
            // Em programação, a contagem de colunas começa em 0 (A=0, B=1, etc.)
            // =======================================================================
            obj['Número do Chamado'] = row[1]; // Coluna B
            obj['De'] = row[4];                // Coluna E (Departamento)
            obj['Tópico de ajuda'] = row[8];   // Coluna I (Serviço)
            obj['ANO'] = row[30];              // Coluna AD (Ano)
            // obj['MES'] = row[XX];           // Se tiver uma coluna para MÊS, coloque o número dela aqui

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
    
    // Os filtros agora usam os dados que garantimos que existem no objeto
    if (categoria) filteredData = filteredData.filter(r => r['Tópico de ajuda'] === categoria);
    if (departamento) filteredData = filteredData.filter(r => r['De'] === departamento);
    if (status) filteredData = filteredData.filter(r => r['Status Atual'] === status);
    if (ano) filteredData = filteredData.filter(r => r['ANO'] == ano);
    if (mes) filteredData = filteredData.filter(r => r['MES'] == mes);

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
        const tempoStr = row[nomeDaColunaDeTempo]; 
        if (cat && tempoStr) {
            const tempo = parseFloat(String(tempoStr).replace(',', '.'));
            if (!isNaN(tempo)) {
                if (!categoryData[cat]) categoryData[cat] = { sum: 0, count: 0 };
                categoryData[cat].sum += tempo;
                categoryData[cat].count++;
            }
        }
    });

    const tempoMedio = {};
    for (const cat in categoryData) {
        tempoMedio[cat] = parseFloat((categoryData[cat].sum / categoryData[cat].count).toFixed(2));
    }
    
    // --- Opções de Filtro Dinâmicas ---
    const getOptionsFrom = (dataSet, key) => [...new Set(dataSet.map(row => row[key]).filter(Boolean))];

    const opcoesFiltro = {
        categoria: getOptionsFrom(allData, 'Tópico de ajuda'),
        departamento: getOptionsFrom(allData, 'De'),
        status: getOptionsFrom(allData, 'Status Atual'),
        ano: getOptionsFrom(allData, 'ANO'),
    };

    res.json({
        kpis: { total: totalChamados, aFazer, concluidos },
        graficos: { porStatus, porCategoria, porSolicitante, tempoMedio },
        opcoesFiltro,
    });
});


// =================================================================
// ROTA PARA DADOS DETALHADOS (TABELA)
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
// LIGANDO O SERVIDOR
// =================================================================
app.listen(PORT, () => {
    console.log(`✅ Servidor rodando na porta ${PORT}`);
});
