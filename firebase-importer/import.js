// Importa as bibliotecas necessárias
const admin = require('firebase-admin');
const fs = require('fs');
const csv = require('csv-parser');

// --- CONFIGURAÇÃO ---
// Aponta para o seu arquivo de chave de serviço baixado do Firebase
const serviceAccount = require('./serviceAccountKey.json');
// NOVO: Carrega nosso mapeamento de colunas, a "fonte da verdade"
const columnsConfig = require('./columnsConfig.json');

// Nome da coleção no Firestore onde os dados serão armazenados
const collectionName = 'chamados';
// --- FIM DA CONFIGURAÇÃO ---

// Inicializa o Firebase Admin SDK
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

// Obtém uma referência ao banco de dados Firestore
const db = admin.firestore();

/**
 * AJUSTADO: Função para processar, limpar e PADRONIZAR cada linha do CSV.
 * Transforma um array de dados brutos em um objeto estruturado e limpo.
 * @param {Array<string>} rowArray - A linha do CSV lida como um array.
 * @returns {Object|null} Um objeto de chamado pronto para o Firestore, ou null se for inválido.
 */
function processCsvRow(rowArray) {
  const chamadoData = {};

  for (const key in columnsConfig) {
    const config = columnsConfig[key];
    const rawValue = rowArray[config.programmaticIndex]?.trim(); // Pega o valor pelo índice e remove espaços

    if (!rawValue) {
      chamadoData[key] = null;
      continue;
    }

    // --- CORREÇÃO APLICADA AQUI ---
    // Se a chave for 'status', padroniza o valor para maiúsculas para consistência.
    if (key === 'status') {
        chamadoData[key] = rawValue.toUpperCase();
    } 
    // Para todas as outras chaves, aplica a conversão de tipo normal.
    else {
        // Trata os tipos de dados conforme a configuração
        switch (config.type) {
          case 'number':
            // Converte 'R$ 1.234,56' para o número 1234.56
            chamadoData[key] = parseFloat(rawValue.replace('R$', '').replace(/\./g, '').replace(',', '.')) || 0;
            break;
          case 'date':
            // Converte 'DD/MM/YYYY' para um objeto de Data do Firebase (Timestamp)
            const parts = rawValue.split('/');
            if (parts.length === 3) {
              const [day, month, year] = parts;
              // Formato YYYY-MM-DD é seguro para o construtor Date
              const isoDate = new Date(`${year}-${month}-${day}`);
              chamadoData[key] = admin.firestore.Timestamp.fromDate(isoDate);
            } else {
              chamadoData[key] = null; // Data em formato inválido
            }
            break;
          default: // 'string'
            chamadoData[key] = rawValue;
        }
    }
  }
  
  // O número do chamado é essencial para o ID do documento
  if (!chamadoData.numero) {
    return null; // Retorna null se não houver número do chamado
  }

  return chamadoData;
}


// Array para armazenar os objetos de chamado processados
const records = [];

console.log('Iniciando a leitura do arquivo CSV...');

fs.createReadStream('BD_CHAM.csv')
  // MUDANÇA: 'headers: false' lê cada linha como um array, ignorando os cabeçalhos.
  // 'skipLines: 1' pula a primeira linha (que é o cabeçalho).
  .pipe(csv({ headers: false, skipLines: 1 }))
  .on('data', (rowArray) => {
    // MUDANÇA: Em vez de usar o objeto bruto, processamos a linha
    const processedRecord = processCsvRow(Object.values(rowArray));
    if (processedRecord) {
      records.push(processedRecord);
    }
  })
  .on('end', async () => {
    if (records.length === 0) {
      console.log('Nenhum registro válido encontrado para importar.');
      return;
    }

    console.log(`Leitura do CSV concluída. ${records.length} registros válidos encontrados.`);
    console.log('Iniciando o upload para o Firestore...');

    // O Firestore tem um limite de 500 operações por batch.
    // A lógica de lotes é mantida, pois é uma ótima prática.
    for (let i = 0; i < records.length; i += 500) {
      const batch = db.batch();
      const chunk = records.slice(i, i + 500);

      chunk.forEach(record => {
        // MUDANÇA: A lógica para obter o ID agora é direta e segura
        const docId = record.numero;
        // O restante dos dados já está no formato correto
        const { numero, ...chamadoData } = record; 
        
        const docRef = db.collection(collectionName).doc(docId);
        // Usamos set com merge: true para criar ou atualizar sem sobrescrever campos não mencionados.
        batch.set(docRef, chamadoData, { merge: true });
      });

      // Executa o lote de operações
      await batch.commit();
      console.log(`Lote de ${chunk.length} documentos enviado com sucesso.`);
    }

    console.log('--- Processo de importação concluído! ---');
  });
  