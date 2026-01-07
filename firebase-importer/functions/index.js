/* eslint-disable guard-for-in */
const {onSchedule} = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");
const {google} = require("googleapis");
const logger = require("firebase-functions/logger");
const fetch = require("node-fetch");
const {onRequest} = require("firebase-functions/v2/https");

// --- INICIALIZAÇÃO PADRÃO E SEGURA (SEM ARGUMENTOS) ---
admin.initializeApp();
// --- FIM DA INICIALIZAÇÃO ---

// --- CONFIGURAÇÃO GERAL ---
const SPREADSHEET_ID = "11uYaOh6jJDsyNm1OPKnC_MpMcA9FL2aXWKPjeMlkhW4";
const DATA_RANGE = "BD_CHAM!B2:AF";
const collectionName = "chamados";
const TELEGRAM_BOT_TOKEN = "8408859933:AAGgj3nzUtbIoyw-WNEe3f-y9ZtA6DGT4Hk";
const GOOGLE_DRIVE_CHAMADOS_FOLDER_ID = "1UkaYzRZCnHT4amZchlKEWXgvImPAtDm4";
const GOOGLE_DRIVE_IMPORTADOS_FOLDER_ID = "1yaP15Sng116ypDyCa8VgGxT952-coA-m";
const FIREBASE_STORAGE_BUCKET = "studio-7415323994-83446.firebasestorage.app";
// --- FIM DA CONFIGURAÇÃO ---

const serviceAccount = require("./serviceAccountKey.json");
const columnsConfig = require("./columnsConfig.json");

function processSheetRow(rowArray, columnsConfig) {
  const chamadoData = {};
  for (const key in columnsConfig) {
    const config = columnsConfig[key];
    let rawValue = rowArray[config.programmaticIndex - 1];
    if (rawValue === null || rawValue === undefined ||
        String(rawValue).trim() === "") {
      chamadoData[key] = null;
      continue;
    }
    rawValue = String(rawValue).trim();
    if (key === "status") {
      let statusUpper = rawValue.toUpperCase();
      if (statusUpper === "CONCLUIDO") {
        statusUpper = "CONCLUÍDO";
      }
      chamadoData[key] = statusUpper;
    } else {
      switch (config.type) {
        case "number": {
          chamadoData[key] = parseFloat(
              rawValue.replace("R$", "").replace(/\./g, "").replace(",", "."),
          ) || 0;
          break;
        }
        case "date": {
          const parts = rawValue.split("/");
          if (parts.length === 3) {
            const [day, month, year] = parts.map((p) => parseInt(p.trim(), 10));
            if (isNaN(day) || isNaN(month) || isNaN(year) || month < 1 || month > 12 || day < 1 || day > 31) {
              chamadoData[key] = null;
              break;
            }
            const localDate = new Date(year, month - 1, day, 12, 0, 0);
            if (!isNaN(localDate.getTime())) {
              chamadoData[key] = admin.firestore.Timestamp.fromDate(localDate);
            } else {
              chamadoData[key] = null;
            }
          } else {
            chamadoData[key] = null;
          }
          break;
        }
        default: {
          chamadoData[key] = rawValue;
        }
      }
    }
  }
  if (!chamadoData.numero) {
    return null;
  }
  return chamadoData;
}

exports.syncSheetToFirestore = onSchedule({
    schedule: "0 3 * * *",
    timeZone: "America/Sao_Paulo",
}, async (event) => {
  logger.info("Iniciando sincronização com lógica de prevalência refinada...");
  const conflictingChamados = [];
  try {
    const db = admin.firestore();
    const auth = new google.auth.GoogleAuth({
      credentials: serviceAccount,
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });
    const sheets = google.sheets({version: "v4", auth});
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: DATA_RANGE,
    });
    const rows = response.data.values;
    if (!rows || rows.length === 0) return;
    const records = rows.map((row) => processSheetRow(row, columnsConfig)).filter((r) => r && r.numero);
    if (records.length === 0) return;
    const finalStatus = "CONCLUÍDO";
    const agentStartedStatus = "A FAZER";
    const initialStatusSheet = "ABERTO";

    for (let i = 0; i < records.length; i += 500) {
      const batch = db.batch();
      const chunk = records.slice(i, i + 500);
      for (const recordFromSheet of chunk) {
        const docId = String(recordFromSheet.numero);
        const docRef = db.collection(collectionName).doc(docId);
        const docSnap = await docRef.get();
        let dataToSave = {...recordFromSheet};
        let skipUpdate = false;
        if (docSnap.exists) {
          const existingData = docSnap.data();
          const statusInFirebase = existingData.status;
          const statusInSheet = recordFromSheet.status;
          if (statusInSheet === finalStatus) {
            if (!dataToSave.dataConclusao && existingData.dataConclusao) {
               dataToSave.dataConclusao = existingData.dataConclusao;
            } else if (!dataToSave.dataConclusao && !existingData.dataConclusao) {
               dataToSave.dataConclusao = admin.firestore.FieldValue.serverTimestamp();
            }
          } else if (statusInFirebase === finalStatus && statusInSheet !== finalStatus) {
            conflictingChamados.push(docId);
            skipUpdate = true;
          } else if (statusInFirebase === agentStartedStatus && statusInSheet === initialStatusSheet) {
            dataToSave.status = statusInFirebase;
            dataToSave.dataConclusao = null;
          } else {
              if (dataToSave.status !== finalStatus) {
                  dataToSave.dataConclusao = null;
              }
          }
        }
        if (!skipUpdate) {
            const finalData = {...dataToSave};
            delete finalData.numero;
            batch.set(docRef, finalData, {merge: true});
        }
      }
      await batch.commit();
    }
    // Notificação de conflitos para MÚLTIPLOS administradores
    if (conflictingChamados.length > 0) {
        try {
            const db = admin.firestore();
            const adminConfig = await db.collection("config").doc("admin").get();
            if (adminConfig.exists) {
                const adminChatIds = adminConfig.data().telegramChatIds; // Lê o array
                if (adminChatIds && adminChatIds.length > 0) {
                    let conflictMessage = `⚠️ *Atenção: Conflito de Status*\n\nChamados CONCLUÍDOS no sistema, mas NÃO na planilha:\n\n`;
                    conflictingChamados.forEach((id) => {
                        conflictMessage += `- Chamado: *${id}*\n`;
                    });
                    for (const adminId of adminChatIds) {
                        await sendMessage(adminId, conflictMessage);
                    }
                }
            }
        } catch(e) {
            logger.error("Falha ao notificar admins sobre conflito:", e);
        }
    }
    logger.info("Sincronização concluída!");
  } catch (error) {
    logger.error("ERRO CRÍTICO DURANTE A SINCRONIZAÇÃO:", error);
    if (error.errors) logger.error("Detalhes API:", error.errors);
    // Notificação de erro crítico para MÚLTIPLOS administradores
    try {
        const db = admin.firestore();
        const adminConfig = await db.collection("config").doc("admin").get();
        if (adminConfig.exists) {
            const adminChatIds = adminConfig.data().telegramChatIds;
            if (adminChatIds && adminChatIds.length > 0) {
                for (const adminId of adminChatIds) {
                    await sendMessage(adminId, `🚨 *Falha Crítica na Sincronização* 🚨\nVerifique os logs.`);
                }
            }
        }
    } catch (notifyError) {
        logger.error("Falha ao notificar admin sobre erro crítico:", notifyError);
    }
    throw error;
  }
});

async function sendMessage(chatId, text, keyboard = null) {
  const body = {
    chat_id: chatId,
    text: text,
    parse_mode: "Markdown",
    disable_web_page_preview: true,
  };
  if (keyboard) {
    body.reply_markup = keyboard;
  }
  const telegramApiUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  try {
      const response = await fetch(telegramApiUrl, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(body),
      });
      const responseJson = await response.json();
      if (!responseJson.ok) {
          logger.error(`Falha ao enviar mensagem para Chat ID ${chatId}.`, responseJson);
      }
  } catch (error) {
      logger.error(`Erro de rede ao enviar mensagem para Chat ID ${chatId}:`, error);
  }
}

exports.sendTelegramNotifications = onSchedule({
    schedule:"0 5 * * 1-5",
    timeZone: "America/Sao_Paulo",
}, async (event) => {
  logger.info("Iniciando envio de notificações com métricas...");
  const db = admin.firestore();
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const sevenDaysAgoTimestamp = admin.firestore.Timestamp.fromDate(sevenDaysAgo);
  const thirtyDaysAgoTimestamp = admin.firestore.Timestamp.fromDate(thirtyDaysAgo);

  try {
    const agentesSnapshot = await db.collection("agentes").get();
    if (agentesSnapshot.empty) return;

    for (const agenteDoc of agentesSnapshot.docs) {
      const agenteData = agenteDoc.data();
      const servico = agenteDoc.id;
      const chatIds = agenteData.telegramChatIds;
      if (!chatIds || chatIds.length === 0) continue;

      const chamadosPendentesSnap = await db.collection("chamados")
          .where("servico", "==", servico)
          .where("status", "in", ["A FAZER", "ABERTO"])
          .get();
      const countPendentes = chamadosPendentesSnap.size;

      const concluídos7dSnap = await db.collection("chamados")
          .where("servico", "==", servico)
          .where("status", "==", "CONCLUÍDO")
          .where("dataConclusao", ">=", sevenDaysAgoTimestamp)
          .get();
      const countConcluidos7d = concluídos7dSnap.size;

      const concluídos30dSnap = await db.collection("chamados")
          .where("servico", "==", servico)
          .where("status", "==", "CONCLUÍDO")
          .where("dataConclusao", ">=", thirtyDaysAgoTimestamp)
          .get();

      let totalTempoConclusao = 0;
      let countParaTMC = 0;
      concluídos30dSnap.forEach((doc) => {
        const data = doc.data();
        if (data.dataAbertura && data.dataConclusao && data.dataAbertura.toDate && data.dataConclusao.toDate) {
          const abertura = data.dataAbertura.toDate();
          const conclusao = data.dataConclusao.toDate();
          const diffTime = Math.abs(conclusao - abertura);
          const diffDays = diffTime / (1000 * 60 * 60 * 24);
          totalTempoConclusao += diffDays;
          countParaTMC++;
        }
      });
      const tempoMedioConclusao = countParaTMC > 0 ? (totalTempoConclusao / countParaTMC).toFixed(1) : "N/A";

      let messageText = `Bom dia, equipe de ${servico}!\n\n`;
      messageText += `*Resumo Recente:*\n`;
      messageText += `✅ Concluídos (7d): *${countConcluidos7d}*\n`;
      messageText += `⏱️ Tempo Médio (30d): *${tempoMedioConclusao} dias*\n\n`;
      if (countPendentes === 0) {
        messageText += `🎉 Nenhum chamado pendente no momento!`;
      } else {
        messageText += `*Pendentes Atuais: ${countPendentes} chamados*\n\n`;
        chamadosPendentesSnap.forEach((doc) => {
          const chamadoId = doc.id;
          const chamadoData = doc.data();
          const departamento = chamadoData.departamento || "N/D";
          if (chamadoData.anexoUrl) {
            messageText += `➡️ Chamado: [*${chamadoId}*](${chamadoData.anexoUrl}) | ${departamento}\n`;
          } else {
            messageText += `➡️ Chamado: *${chamadoId}* | ${departamento}\n`;
          }
        });
        messageText += `\nPara alterar o status, use: \`/alterar NUMERO_DO_CHAMADO\``;
      }

      for (const chatId of chatIds) {
        await sendMessage(chatId, messageText);
      }
    }
    logger.info("Notificações com métricas enviadas!");
  } catch (error) {
    logger.error("ERRO AO ENVIAR NOTIFICAÇÕES COM MÉTRICAS:", error);
    // Reporta erro aos administradores
    try {
        const adminConfig = await db.collection("config").doc("admin").get();
        if (adminConfig.exists) {
            const adminChatIds = adminConfig.data().telegramChatIds;
            if (adminChatIds && adminChatIds.length > 0) {
                for (const adminId of adminChatIds) {
                    await sendMessage(adminId, "⚠️ Falha ao enviar notificações para os agentes. Verifique os logs.");
                }
            }
        }
    } catch (notifyError) {
        logger.error("Falha ao notificar admin sobre erro:", notifyError);
    }
    throw error;
  }
});

exports.handleTelegramCallback = onRequest(async (req, res) => {
  const body = req.body;
  const db = admin.firestore();

  if (body.message) {
    const message = body.message;
    const chatId = message.chat.id;
    const text = (message.text || "").toLowerCase();
    if (text.startsWith("/alterar")) {
      const parts = message.text.split(" ");
      const chamadoId = parts[1];
      if (!chamadoId) {
        await sendMessage(chatId, "Especifique o número do chamado. Ex: `/alterar 123456`");
      } else {
        const keyboard = {
          inline_keyboard: [[
            {text: "▶️ A FAZER", callback_data: `update_status:${chamadoId}:A FAZER`},
            {text: "✅ Resolvido", callback_data: `update_status:${chamadoId}:CONCLUÍDO`},
          ]],
        };
        let replyText = "";
        try {
            const docRef = db.collection("chamados").doc(chamadoId);
            const docSnap = await docRef.get();
            if (docSnap.exists && docSnap.data().anexoUrl) {
                replyText = `[Ver Anexo](${docSnap.data().anexoUrl})\n\n`;
            }
        } catch(e) {
            logger.error(`Falha ao buscar anexo para ${chamadoId}:`, e);
        }
        replyText += `O que fazer com o chamado *${chamadoId}*?`;
        await sendMessage(chatId, replyText, keyboard);
      }
    }
    res.status(200).send("ok");
    return;
  }

  if (body.callback_query) {
    const callbackQuery = body.callback_query;
    const [action, chamadoId, newStatus] = callbackQuery.data.split(":");
    const chatId = callbackQuery.message.chat.id;
    const agentName = callbackQuery.from.first_name;
    if (action === "update_status") {
      try {
        const chamadoRef = db.collection("chamados").doc(chamadoId);
        const docBefore = await chamadoRef.get();
        const statusBefore = docBefore.exists ? docBefore.data().status : null;
        if (statusBefore === newStatus) {
          await sendMessage(chatId, `O chamado *${chamadoId}* já está ${newStatus}.`);
        } else {
          const updateData = {status: newStatus, lastUpdatedBy: agentName};
          if (newStatus === "CONCLUÍDO") {
            updateData.dataConclusao = admin.firestore.FieldValue.serverTimestamp();
          }
          await chamadoRef.update(updateData);
          await sendMessage(chatId, `Chamado *${chamadoId}* atualizado para *${newStatus}*!`);
          
          // --- Notificação de status para MÚLTIPLOS administradores ---
          try {
            const adminConfig = await db.collection("config").doc("admin").get();
            if (adminConfig.exists) {
              const adminChatIds = adminConfig.data().telegramChatIds; // Lê o array
              if (adminChatIds && adminChatIds.length > 0) {
                const notificationText = `🔔 Status Update\n\nChamado *${chamadoId}* -> *${newStatus}* por *${agentName}*.`;
                for (const adminId of adminChatIds) {
                    await sendMessage(adminId, notificationText);
                }
              }
            }
          } catch(e) {
            logger.error("Falha ao notificar admin:", e);
          }
          // ---------------------------------------------------------
        }
      } catch (error) {
        logger.error(`Erro ao atualizar ${chamadoId}:`, error);
        await sendMessage(chatId, `Erro ao atualizar o chamado ${chamadoId}.`);
      }
    }
    res.status(200).send("ok");
    return;
  }
  res.status(200).send("Ok");
});

exports.sendAdminSummary = onSchedule({
    schedule: "0 6 * * 1-5",
    timeZone: "America/Sao_Paulo",
}, async (event) => {
  logger.info("Iniciando envio de resumo para os administradores.");
  const db = admin.firestore();
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const sevenDaysAgoTimestamp = admin.firestore.Timestamp.fromDate(sevenDaysAgo);
  const thirtyDaysAgoTimestamp = admin.firestore.Timestamp.fromDate(thirtyDaysAgo);

  try {
    // 1. Busca os Chat IDs dos Admins (Agora um Array)
    const adminConfig = await db.collection("config").doc("admin").get();
    if (!adminConfig.exists) {
      logger.error("Documento de config do admin não encontrado.");
      return;
    }
    const adminChatIds = adminConfig.data().telegramChatIds;
    if (!adminChatIds || adminChatIds.length === 0) {
      logger.error("Nenhum Chat ID de admin encontrado.");
      return;
    }

    const agentesSnapshot = await db.collection("agentes").get();
    if (agentesSnapshot.empty) {
        for (const adminId of adminChatIds) {
            await sendMessage(adminId, "Nenhum serviço/agente encontrado.");
        }
        return;
    }

    let summaryMessage = `📊 *Resumo de Desempenho Diário* 📊\n`;
    summaryMessage += `_(Dados dos últimos 7/30 dias)_\n\n`;
    let hasData = false;

    for (const agenteDoc of agentesSnapshot.docs) {
      const servico = agenteDoc.id;
      hasData = true;

      const chamadosPendentesSnap = await db.collection("chamados")
          .where("servico", "==", servico)
          .where("status", "in", ["A FAZER", "ABERTO"])
          .get();
      const countPendentes = chamadosPendentesSnap.size;

      const concluídos7dSnap = await db.collection("chamados")
          .where("servico", "==", servico)
          .where("status", "==", "CONCLUÍDO")
          .where("dataConclusao", ">=", sevenDaysAgoTimestamp)
          .get();
      const countConcluidos7d = concluídos7dSnap.size;

      const concluídos30dSnap = await db.collection("chamados")
          .where("servico", "==", servico)
          .where("status", "==", "CONCLUÍDO")
          .where("dataConclusao", ">=", thirtyDaysAgoTimestamp)
          .get();

      let totalTempoConclusao = 0;
      let countParaTMC = 0;
      concluídos30dSnap.forEach((doc) => {
        const data = doc.data();
        if (data.dataAbertura && data.dataConclusao && data.dataAbertura.toDate && data.dataConclusao.toDate) {
          const abertura = data.dataAbertura.toDate();
          const conclusao = data.dataConclusao.toDate();
          const diffTime = Math.abs(conclusao - abertura);
          const diffDays = diffTime / (1000 * 60 * 60 * 24);
          totalTempoConclusao += diffDays;
          countParaTMC++;
        }
      });
      const tempoMedioConclusao = countParaTMC > 0 ? (totalTempoConclusao / countParaTMC).toFixed(1) : "N/A";

      summaryMessage += `*${servico}:*\n`;
      summaryMessage += `  ✅ Concluídos (7d): *${countConcluidos7d}*\n`;
      summaryMessage += `  ⏱️ TMC (30d): *${tempoMedioConclusao} dias*\n`;
      summaryMessage += `  ⏳ Pendentes: *${countPendentes}*\n\n`;
    }

    if (hasData) {
      summaryMessage += `_(TMC = Tempo Médio de Conclusão)_`;
      // Envia para TODOS os administradores
      for (const adminId of adminChatIds) {
        await sendMessage(adminId, summaryMessage);
      }
      logger.info("Resumo enviado para os administradores.");
    } else {
      logger.info("Nenhum dado de serviço para enviar resumo.");
    }

  } catch (error) {
    logger.error("ERRO AO GERAR/ENVIAR RESUMO PARA O ADMIN:", error);
    if (error.code === 9) {
      logger.error("Índice necessário:", error.details);
    }
    try {
        const db = admin.firestore();
        const adminConfig = await db.collection("config").doc("admin").get();
        if (adminConfig.exists) {
            const adminChatIds = adminConfig.data().telegramChatIds;
            if (adminChatIds && adminChatIds.length > 0) {
                for (const adminId of adminChatIds) {
                    await sendMessage(adminId, "⚠️ Falha ao gerar resumo. Verifique os logs.");
                }
            }
        }
    } catch (notifyError) {
        logger.error("Falha ao notificar admin sobre erro:", notifyError);
    }
    throw error;
  }
});

exports.syncImagesToStorage = onSchedule({
    schedule: "0-14 0 * * 1-5", // 00:00 a 00:14, Seg-Sex
    timeZone: "America/Sao_Paulo",
    timeoutSeconds: 540, 
}, async (event) => {
    logger.info("Iniciando sincronização de imagens do Google Drive...");
    const db = admin.firestore();
    const storage = admin.storage().bucket(FIREBASE_STORAGE_BUCKET);
    const auth = new google.auth.GoogleAuth({
      credentials: serviceAccount,
      scopes: ["https://www.googleapis.com/auth/drive"],
    });
    const drive = google.drive({version: "v3", auth});

    try {
        const res = await drive.files.list({
            q: `'${GOOGLE_DRIVE_CHAMADOS_FOLDER_ID}' in parents and (mimeType='image/jpeg' or mimeType='image/png' or mimeType='application/pdf')`,
            fields: "files(id, name, mimeType)",
            pageSize: 1, 
        });

        const files = res.data.files;
        if (!files || files.length === 0) {
            logger.info("Nenhum ficheiro novo encontrado no Google Drive.");
            return;
        }

        logger.info(`Encontrados ${files.length} novos ficheiros. Processando...`);
        const file = files[0];
        const fileId = file.id;
        const fileName = file.name;
        const destinationPath = `chamados/${fileName}`;
        const chamadoId = fileName.split('.')[0];

        try {
            const driveStream = await drive.files.get(
                {fileId: fileId, alt: "media"},
                {responseType: "stream"}
            );
            const storageFile = storage.file(destinationPath);
            const storageStream = storageFile.createWriteStream({
                metadata: {
                    contentType: file.mimeType,
                },
            });
            await new Promise((resolve, reject) => {
                driveStream.data
                    .pipe(storageStream)
                    .on("error", reject)
                    .on("finish", resolve);
            });
            await storageFile.makePublic();
            const publicUrl = `https://storage.googleapis.com/${FIREBASE_STORAGE_BUCKET}/${destinationPath}`;
            const docRef = db.collection("chamados").doc(chamadoId);
            await docRef.set({
                anexoUrl: publicUrl
            }, { merge: true });
            await drive.files.update({
                fileId: fileId,
                addParents: GOOGLE_DRIVE_IMPORTADOS_FOLDER_ID,
                removeParents: GOOGLE_DRIVE_CHAMADOS_FOLDER_ID,
                fields: "id, parents",
            });
            logger.info(`Ficheiro ${fileName} importado, link salvo no chamado ${chamadoId}, e movido.`);
        } catch (fileError) {
            logger.error(`Falha ao processar o ficheiro ${fileName} (ID: ${fileId}):`, fileError);
        }
        logger.info("Sincronização de imagem única concluída.");
    } catch (error) {
        logger.error("ERRO CRÍTICO NA SINCRONIZAÇÃO DE IMAGENS:", error);
        try {
            const adminConfig = await db.collection("config").doc("admin").get();
            if (adminConfig.exists) {
                const adminChatIds = adminConfig.data().telegramChatIds;
                if (adminChatIds && adminChatIds.length > 0) {
                    for (const adminId of adminChatIds) {
                         await sendMessage(adminId, "🚨 *Falha Crítica na Sincronização de Imagens* 🚨\nVerifique os logs.");
                    }
                }
            }
        } catch (notifyError) {
            logger.error("Falha ao notificar admin sobre erro de sync de imagens:", notifyError);
        }
        throw error;
    }
});