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
            range: 'BD_CHAM!A:AF',
            valueRenderOption: 'UNFORMATTED_VALUE'
        });
        
        const rows = response.data.values;
        if (!rows || rows.length < 2) return [];

        const header = rows[0].map(h => h ? h.trim() : `UNKNOWN_COLUMN_${Math.random()}`);
        
        const data = rows.slice(1).map(row => {
            let obj = {};
            header.forEach((key, i) => {
                obj[key] = row[i];
            });

            // Mapeamento explícito para garantir consistência.
            obj['Número do Chamado'] = row[1]; // Coluna B
            obj['De'] = row[4];               // Coluna E (Departamento)
            obj['Tópico de ajuda'] = row[8];    // Coluna I (Serviço)
            obj['Custo'] = row[31];           // Coluna AF (índice 31)

            // CORREÇÃO: Derivar ano e mês da data de criação para um filtro confiável.
            // Isso ignora a coluna 'ANO' e usa a data real do chamado.
            // Assumindo que o nome da coluna de data é 'Data de criação'.
            const creationDateSerial = obj['Data de criação'];
            if (typeof creationDateSerial === 'number' && creationDateSerial > 0) {
                // Converte o número de série de data do Google Sheets para um objeto Date do JavaScript.
                const creationDate = new Date(1899, 11, 30 + creationDateSerial);
                if (!isNaN(creationDate.getTime())) {
                    obj.creationYear = creationDate.getFullYear();
                    obj.creationMonth = creationDate.getMonth() + 1; // getMonth() é 0-indexed (Jan=0), então somamos 1.
                }
            }

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

    // CORREÇÃO: Lógica de filtro para ano e mês usando os novos campos derivados.
    if (ano) {
        const yearNum = parseInt(ano, 10);
        filteredData = filteredData.filter(r => r.creationYear === yearNum);
    }
    if (mes) {
        const monthNum = parseInt(mes, 10);
        filteredData = filteredData.filter(r => r.creationMonth === monthNum);
    }

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

    // Lógica de cálculo de despesas.
    const despesasPorDepartamento = {};
    const despesasPorServico = {};

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
        // CORREÇÃO: Gera a lista de anos a partir dos dados de data de criação.
        ano: [...new Set(allData.map(row => row.creationYear).filter(Boolean))].sort((a, b) => b - a),
    };

    // Resposta da API com os novos dados de despesa
    res.json({
        kpis: { total: totalChamados, aFazer, concluidos },
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
