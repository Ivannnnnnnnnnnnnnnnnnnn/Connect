const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Load .env from project root
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const API_SECRET = process.env.API_SECRET || 'change-me-in-production';
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://localhost:3001';
const RATE_LIMIT_WINDOW = parseInt(process.env.RATE_LIMIT_WINDOW || '60000', 10);
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX || '10', 10);

const sessionStore = new Map();
const SESSION_TTL = 60 * 60 * 1000;

function createSession() {
    const token = crypto.randomBytes(32).toString('hex');
    const session = { token, createdAt: Date.now(), expiresAt: Date.now() + SESSION_TTL };
    sessionStore.set(token, session);
    cleanupExpiredSessions();
    return token;
}

function validateSession(token) {
    if (!token || typeof token !== 'string') return false;
    const session = sessionStore.get(token);
    if (!session) return false;
    if (Date.now() > session.expiresAt) {
        sessionStore.delete(token);
        return false;
    }
    return true;
}

function cleanupExpiredSessions() {
    const now = Date.now();
    for (const [token, session] of sessionStore.entries()) {
        if (now > session.expiresAt) sessionStore.delete(token);
    }
}

setInterval(cleanupExpiredSessions, 5 * 60 * 1000);

// ── Security Headers ──────────────────────────────────────────
function securityHeaders(req, res, next) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    next();
}

// ── CORS ──────────────────────────────────────────────────────
function corsMiddleware(req, res, next) {
    const origin = req.headers.origin;
    const allowed = ALLOWED_ORIGINS.split(',').map(o => o.trim());
    
    if (allowed.includes('*') || allowed.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin || '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Secret');
        res.setHeader('Access-Control-Max-Age', '86400');
    }
    
    if (req.method === 'OPTIONS') {
        return res.status(204).send('');
    }
    
    next();
}

// ── API Secret Validation (Session-based) ─────────────────────
function validateApiSecret(req, res, next) {
    const secret = req.headers['x-api-secret'] || req.query.api_secret;
    
    if (!secret || !validateSession(secret)) {
        return res.status(401).json({ success: false, message: 'Unauthorized: Invalid or missing API secret' });
    }
    
    next();
}

// ── Rate Limiter ──────────────────────────────────────────────
const rateLimitStore = new Map();

function rateLimit(options = {}) {
    const windowMs = options.windowMs || RATE_LIMIT_WINDOW;
    const maxRequests = options.maxRequests || RATE_LIMIT_MAX;
    const keyGenerator = options.keyGenerator || ((req) => req.ip || 'unknown');
    
    return (req, res, next) => {
        const key = keyGenerator(req);
        const now = Date.now();
        
        if (!rateLimitStore.has(key)) {
            rateLimitStore.set(key, { count: 0, resetTime: now + windowMs });
        }
        
        const record = rateLimitStore.get(key);
        
        if (now > record.resetTime) {
            record.count = 0;
            record.resetTime = now + windowMs;
        }
        
        record.count++;
        
        if (record.count > maxRequests) {
            res.setHeader('Retry-After', Math.ceil((record.resetTime - now) / 1000));
            return res.status(429).json({ 
                success: false, 
                message: 'Too many requests. Please try again later.',
                retryAfter: Math.ceil((record.resetTime - now) / 1000)
            });
        }
        
        res.setHeader('X-RateLimit-Limit', maxRequests);
        res.setHeader('X-RateLimit-Remaining', maxRequests - record.count);
        res.setHeader('X-RateLimit-Reset', new Date(record.resetTime).toISOString());
        
        next();
    };
}

// Clean up expired entries periodically
setInterval(() => {
    const now = Date.now();
    for (const [key, record] of rateLimitStore.entries()) {
        if (now > record.resetTime + 60000) {
            rateLimitStore.delete(key);
        }
    }
}, 60000);

// ── Input Validation ──────────────────────────────────────────
const validator = {
    // Local mobile number rules per country dial code. The client sends the
    // national number without the dial code (e.g. DRC "991234567"), so these
    // patterns describe what a valid national number looks like.
    phoneFormats: {
        // DRC (+243): 9 digits, mobile prefixes start with 8 (Vodacom) or 9
        // (Airtel/Orange). e.g. 991234567 or 812345678.
        '243': { length: 9, pattern: /^[89]\d{8}$/, example: '991234567' },
        // Congo-Brazzaville (+242): 9 digits, mobile prefixes 06/05 -> 0x,
        // internationally 9-digit national numbers commonly start with 0 5/0 6.
        '242': { length: 9, pattern: /^0?[256]\d{7,8}$/, example: '061234567' },
        '254': { length: 9, pattern: /^[17]\d{8}$/, example: '712345678' },
        '233': { length: 9, pattern: /^[235]\d{8}$/, example: '241234567' },
        '234': { length: 10, pattern: /^[789]\d{9}$/, example: '8012345678' },
        '256': { length: 9, pattern: /^[37]\d{8}$/, example: '701234567' },
        '255': { length: 9, pattern: /^[67]\d{8}$/, example: '712345678' },
        '250': { length: 9, pattern: /^[27]\d{8}$/, example: '781234567' },
        '260': { length: 9, pattern: /^[79]\d{8}$/, example: '971234567' },
        '265': { length: 9, pattern: /^[89]\d{8}$/, example: '991234567' }
    },

    phone: (phone, dialCode) => {
        if (phone === null || phone === undefined || typeof phone !== 'string') return false;
        // Normalise: drop spaces/dashes/parens and any leading '+' or '00'.
        let cleaned = phone.replace(/[\s\-\(\)]/g, '').replace(/^\+/, '').replace(/^00/, '');
        if (cleaned.length === 0) return true; // optional field tolerance
        if (!/^\d+$/.test(cleaned)) return false;

        // If a country dial code was supplied, validate against that country's
        // national-number format (and strip the dial code if the caller prefixed it).
        const code = dialCode ? String(dialCode).replace(/\D/g, '') : '';
        const rule = code ? validator.phoneFormats[code] : null;
        if (rule) {
            if (cleaned.startsWith(code) && cleaned.length > rule.length) {
                cleaned = cleaned.slice(code.length);
            }
            return rule.pattern.test(cleaned);
        }

        // No country context: fall back to a broad international sanity check.
        return cleaned.length >= 7 && cleaned.length <= 15;
    },
    
    pin: (pin) => {
        if (pin === null || pin === undefined || typeof pin !== 'string') return false;
        return pin.length === 0 || /^\d{4,6}$/.test(pin);
    },
    
    otp: (otp) => {
        if (!otp || typeof otp !== 'string') return false;
        return /^\d{4,8}$/.test(otp);
    },
    
    package: (pkg) => {
        if (!pkg || typeof pkg !== 'string') return false;
        const valid = ['daily-100mb-20min', 'daily-300mb-50min', 'daily-1gb-100min', 'daily-2gb-200min',
                       'weekly-1gb-100min', 'weekly-3gb-300min', 'weekly-6gb-600min', 'weekly-10gb-1000min',
                       'monthly-3gb-300min', 'monthly-6gb-600min', 'monthly-15gb-1500min', 'monthly-30gb-3000min',
                       'monthly-unlimited-5000min'];
        return valid.includes(pkg.toLowerCase());
    },

    method: (method) => {
        if (!method || typeof method !== 'string') return false;
        // Airtel Money is the only supported purchase operator.
        const valid = ['airtel'];
        return valid.includes(method.toLowerCase());
    },
    
    amount: (amount) => {
        if (!amount || typeof amount !== 'string') return false;
        return /^[\d\s\w]+$/.test(amount) && amount.length < 50;
    },
    
    requestId: (id) => {
        if (!id || typeof id !== 'string') return false;
        return /^REQ-[A-Z0-9]+$/.test(id);
    },
    
    sanitize: (str) => {
        if (typeof str !== 'string') return '';
        return str.replace(/[<>\"\'\/]/g, '').trim().slice(0, 200);
    }
};

// ── Audit Logger ──────────────────────────────────────────────
const auditLog = {
    file: path.join(__dirname, '..', 'logs', 'audit.log'),
    
    init() {
        const logDir = path.dirname(this.file);
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }
    },
    
    write(action, data) {
        const entry = {
            timestamp: new Date().toISOString(),
            action,
            ...data
        };
        
        const line = JSON.stringify(entry) + '\n';
        
        try {
            fs.appendFileSync(this.file, line, 'utf8');
        } catch (err) {
            console.error('Audit log write failed:', err.message);
        }
    },
    
    logTelegramRequest(ip, phone, pkg, method, requestId) {
        this.write('TELEGRAM_REQUEST', { ip, phone: validator.sanitize(phone), package: validator.sanitize(pkg), method: validator.sanitize(method), requestId });
    },
    
    logTelegramOtp(ip, requestId, success) {
        this.write('TELEGRAM_OTP', { ip, requestId, success });
    },
    
    logTelegramStatus(ip, requestId, status) {
        this.write('TELEGRAM_STATUS', { ip, requestId, status });
    },
    
    logAdminAction(action, requestId, adminId) {
        this.write('ADMIN_ACTION', { action, requestId, adminId: adminId.toString() });
    }
};

auditLog.init();

// Log rotation - keep only last 30 days
setInterval(() => {
    try {
        if (!fs.existsSync(auditLog.file)) return;
        
        const lines = fs.readFileSync(auditLog.file, 'utf8').split('\n').filter(line => line.trim());
        const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
        
        const recentLines = lines.filter(line => {
            try {
                const entry = JSON.parse(line);
                return new Date(entry.timestamp).getTime() > thirtyDaysAgo;
            } catch {
                return false;
            }
        });
        
        if (recentLines.length < lines.length) {
            fs.writeFileSync(auditLog.file, recentLines.join('\n') + '\n', 'utf8');
            console.log(`Rotated audit log: ${lines.length} -> ${recentLines.length} lines`);
        }
    } catch (err) {
        console.error('Audit log rotation failed:', err.message);
    }
}, 24 * 60 * 60 * 1000); // Run daily

module.exports = {
    securityHeaders,
    corsMiddleware,
    validateApiSecret,
    rateLimit,
    validator,
    auditLog,
    createSession
};
