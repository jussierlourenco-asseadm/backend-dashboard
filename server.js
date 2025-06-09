const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');

// =================================================================
// CONFIGURAÇÕES
// =================================================================
const app = express();
app.use(cors());
const PORT = 3001;
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

        const header = rows[0].map(h => h ? h.trim() : 'UNKNOWN_COLUMN');
        const data = rows.slice(1).map(row => {
            let obj = {};
            header.forEach((key, i) => {
                obj[key] = row[i];
            });
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

// =================================================================
// ROTA ÚNICA E INTELIGENTE PARA O DASHBOARD
// =================================================================
app.get('/api/dashboard-data', async (req, res) => {
    let allData = await getSheetData();
    let filteredData = [...allData];

    // Aplica os filtros recebidos pela URL
    const { categoria, departamento, status, ano, mes } = req.query;
    
    if (categoria) filteredData = filteredData.filter(r => r['Tópico de ajuda'] === categoria);
    if (departamento) filteredData = filteredData.filter(r => r['De'] === departamento);
    if (status) filteredData = filteredData.filter(r => r['Status Atual'] === status);
    if (ano) filteredData = filteredData.filter(r => r['ANO'] == ano);
    if (mes) filteredData = filteredData.filter(r => r['MES'] == mes);

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
    
    // --- **NOVO** Opções de Filtro Dinâmicas ---
    // Gera as opções de filtro a partir dos dados JÁ filtrados, para que sejam interdependentes
    const getOptionsFrom = (dataSet, key) => [...new Set(dataSet.map(row => row[key]).filter(Boolean))];

    const opcoesFiltro = {
        categoria: getOptionsFrom(allData.filter(r => (!departamento || r['De'] === departamento) && (!status || r['Status Atual'] === status)), 'Tópico de ajuda'),
        departamento: getOptionsFrom(allData.filter(r => (!categoria || r['Tópico de ajuda'] === categoria) && (!status || r['Status Atual'] === status)), 'De'),
        status: getOptionsFrom(allData.filter(r => (!categoria || r['Tópico de ajuda'] === categoria) && (!departamento || r['De'] === departamento)), 'Status Atual'),
        ano: getOptionsFrom(allData, 'ANO'), // Ano e Mês geralmente não se filtram entre si
    };

    // Envia tudo de uma vez para o frontend
    res.json({
        kpis: { total: totalChamados, aFazer, concluidos },
        graficos: { porStatus, porCategoria, porSolicitante, tempoMedio },
        opcoesFiltro,
    });
});

// =================================================================
// LIGANDO O SERVIDOR
// =================================================================
app.listen(PORT, () => {
    console.log(`✅ Servidor com filtros dinâmicos rodando na porta ${PORT}`);
});
