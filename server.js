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
            // ALTERAÇÃO 1: O range foi expandido de A:AD para A:AF para incluir a coluna de custos.
            range: 'BD_CHAM!A:AF', 
        });
        
        const rows = response.data.values;
        if (!rows || rows.length < 2) return [];

        const header = rows[0].map(h => h ? h.trim() : `UNKNOWN_COLUMN_${Math.random()}`);
        
        const data = rows.slice(1).map(row => {
            let obj = {};
            header.forEach((key, i) => {
                obj[key] = row[i];
            });

            // Mapeamento explícito para garantir consistência, como no seu código original.
            // A contagem de colunas começa em 0 (A=0, B=1, etc.)
            obj['Número do Chamado'] = row[1]; // Coluna B
            obj['De'] = row[4];               // Coluna E (Departamento)
            obj['Tópico de ajuda'] = row[8];    // Coluna I (Serviço)
            obj['ANO'] = row[29];             // Coluna AD (Ano)
            
            // ALTERAÇÃO 2: Adicionada a leitura da coluna de Custo (AF).
            // Coluna AF é a 32ª coluna, que corresponde ao índice 31.
            obj['Custo'] = row[31];

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


// Função auxiliar para filtrar dados (permanece inalterada)
function filterData(data, query) {
    let filteredData = [...data];
    const { categoria, departamento, status, ano, mes } = query;
    
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

    // --- KPIs (inalterado) ---
    const totalChamados = filteredData.length;
    const aFazer = filteredData.filter(r => r['Status Atual']?.toUpperCase() === 'A FAZER').length;
    const concluidos = filteredData.filter(r => r['Status Atual']?.toUpperCase().startsWith('CONCLU')).length;

    // --- Dados para Gráficos (inalterado) ---
    const groupBy = (key, dataSet) => dataSet.reduce((acc, row) => {
        const group = row[key];
        if (group) acc[group] = (acc[group] || 0) + 1;
        return acc;
    }, {});

    const porStatus = groupBy('Status Atual', filteredData);
    const porCategoria = groupBy('Tópico de ajuda', filteredData);
    const porSolicitante = groupBy('De', filteredData);

    // --- Cálculo do Tempo Médio (inalterado) ---
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

    // ALTERAÇÃO 3: Adicionada a lógica para calcular os custos.
    const custosPorDepartamento = {};
    const custosPorServico = {};

    filteredData.forEach(row => {
        const departamento = row['De'];
        const servico = row['Tópico de ajuda'];
        // Lê o valor da coluna de custo, substitui vírgula por ponto e converte para número.
        const custo = parseFloat(String(row['Custo']).replace(',', '.')) || 0;

        if (custo > 0) {
            if (departamento) {
                custosPorDepartamento[departamento] = (custosPorDepartamento[departamento] || 0) + custo;
            }
            if (servico) {
                custosPorServico[servico] = (custosPorServico[servico] || 0) + custo;
            }
        }
    });

    // Arredonda os valores finais para 2 casas decimais.
    for (const key in custosPorDepartamento) {
        custosPorDepartamento[key] = parseFloat(custosPorDepartamento[key].toFixed(2));
    }
    for (const key in custosPorServico) {
        custosPorServico[key] = parseFloat(custosPorServico[key].toFixed(2));
    }
    
    // --- Opções de Filtro Dinâmicas (inalterado) ---
    const getOptionsFrom = (dataSet, key) => [...new Set(dataSet.map(row => row[key]).filter(Boolean))];

    const opcoesFiltro = {
        categoria: getOptionsFrom(allData, 'Tópico de ajuda'),
        departamento: getOptionsFrom(allData, 'De'),
        status: getOptionsFrom(allData, 'Status Atual'),
        ano: getOptionsFrom(allData, 'ANO'),
    };

    // ALTERAÇÃO 4: Adicionados os novos dados de custo ao objeto 'graficos'.
    res.json({
        kpis: { total: totalChamados, aFazer, concluidos },
        graficos: { 
            porStatus, 
            porCategoria, 
            porSolicitante, 
            tempoMedio,
            custosPorDepartamento, // Novo
            custosPorServico       // Novo
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
