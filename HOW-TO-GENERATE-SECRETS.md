# 🔐 HOW TO GENERATE PRODUCTION SECRETS

## ⚡ QUICK START - 3 METHODS

### **METHOD 1: Automated Script (RECOMMENDED)**
```bash
# In lakeside-staging directory:
node generate-secrets.js
```
This will generate ALL secrets with proper security.

### **METHOD 2: Windows Batch File**
```bash
# Double-click or run:
generate-secrets-simple.bat
```

### **METHOD 3: Manual Commands**
Use the commands below to generate each secret individually.

---

## 📋 **SECRETS YOU NEED TO GENERATE**

### **1. JWT_SECRET (64 characters)**
Used for signing JWT authentication tokens.

**Windows PowerShell:**
```powershell
[System.Convert]::ToBase64String((1..32 | ForEach-Object {Get-Random -Maximum 256}))
```

**Node.js:**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Example Output:**
```
b7bc2ae86ea682f06bcce87873dae37443a6c106d706f2f3dc18e9a58df3e0bd
```

---

### **2. SESSION_SECRET (64 characters)**
Used for encrypting session cookies.

**Windows PowerShell:**
```powershell
-join ((65..90) + (97..122) + (48..57) | Get-Random -Count 64 | ForEach-Object {[char]$_})
```

**Node.js:**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Example Output:**
```
a2f891c3d45e67b89012345678901234567890abcdef1234567890abcdef12345
```

---

### **3. ADMIN_USERNAME**
Choose a unique admin username.

**Suggestions:**
- `admin_2024`
- `lakeside_admin`
- `retreat_admin_7264`

**Generate Random Suffix:**
```bash
node -e "console.log('admin_' + require('crypto').randomBytes(4).toString('hex'))"
```

**Example Output:**
```
admin_8f3a2b1c
```

---

### **4. ADMIN_PASSWORD (Strong)**
Create a strong password for admin login.

**Generate Strong Password (16 characters):**
```bash
node -e "const c='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*'; let p=''; for(let i=0;i<16;i++)p+=c[Math.floor(Math.random()*c.length)]; console.log(p)"
```

**Windows PowerShell:**
```powershell
Add-Type -AssemblyName System.Web; [System.Web.Security.Membership]::GeneratePassword(16, 4)
```

**Example Output:**
```
K9#mP2$vL6@nQ8*x
```

⚠️ **SAVE THIS PASSWORD IN A PASSWORD MANAGER!**

---

### **5. ADMIN_PASSWORD_HASH (Bcrypt)**
Convert your password to a bcrypt hash for storage.

**Step 1:** Install bcryptjs (if not installed)
```bash
npm install bcryptjs
```

**Step 2:** Generate hash
```bash
node generate-bcrypt-hash.js
# Enter your password when prompted
```

**Or use one command:**
```bash
node -e "const bcrypt=require('bcryptjs'); const password='YOUR_PASSWORD_HERE'; bcrypt.hash(password, 12, (err,hash)=>console.log(hash))"
```

**Example Output:**
```
$2a$12$dUyWIkzm3JRQpq9gRIA1C.u2v/xuuWUdB146FeRiX3Uc5FyWoFO2G
```

---

### **6. UPLISTING_WEBHOOK_SECRET**
For verifying Uplisting webhooks.

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

### **7. STRIPE KEYS (Production)**
Get these from your Stripe Dashboard.

1. Log into [Stripe Dashboard](https://dashboard.stripe.com)
2. Go to **Developers** → **API Keys**
3. Copy:
   - `STRIPE_SECRET_KEY` (starts with `sk_live_`)
   - `STRIPE_PUBLIC_KEY` (starts with `pk_live_`)
4. For webhooks:
   - Go to **Developers** → **Webhooks**
   - Create endpoint for your domain
   - Copy `STRIPE_WEBHOOK_SECRET` (starts with `whsec_`)

---

## 🚀 **COMPLETE EXAMPLE**

Here's a complete set of example environment variables:

```env
# Server Configuration
NODE_ENV=production
PORT=10000
TRUST_PROXY=true

# Security Secrets (REPLACE WITH YOUR GENERATED VALUES!)
JWT_SECRET=b7bc2ae86ea682f06bcce87873dae37443a6c106d706f2f3dc18e9a58df3e0bd
SESSION_SECRET=a2f891c3d45e67b89012345678901234567890abcdef1234567890abcdef12345
CSRF_SECRET=c3f891d4e56a78b90123456789012345678901234567890abcdef1234567890ab

# Admin Authentication
ADMIN_USERNAME=admin_8f3a2b1c
ADMIN_PASSWORD_HASH=$2a$12$dUyWIkzm3JRQpq9gRIA1C.u2v/xuuWUdB146FeRiX3Uc5FyWoFO2G
JWT_EXPIRY=1h

# Database
DATABASE_URL=sqlite:./lakeside.db
DATABASE_ENCRYPTION_KEY=d4f892e5f67b89012345678901234567890123456789012345678901234567890

# Rate Limiting
LOGIN_RATE_LIMIT_ATTEMPTS=3
LOGIN_RATE_LIMIT_WINDOW_MINUTES=15
BCRYPT_ROUNDS=12

# Stripe (Get from Stripe Dashboard)
STRIPE_SECRET_KEY=sk_live_YOUR_PRODUCTION_KEY
STRIPE_PUBLIC_KEY=pk_live_YOUR_PRODUCTION_KEY
STRIPE_WEBHOOK_SECRET=whsec_YOUR_WEBHOOK_SECRET

# Uplisting (Get from Uplisting)
UPLISTING_API_KEY=YOUR_NEW_API_KEY
UPLISTING_WEBHOOK_SECRET=e5f893f6g78c90123456789012345678901234567890123456789012345678901
UPLISTING_API_URL=https://api.uplisting.io/v1
UPLISTING_SYNC_ENABLED=true
UPLISTING_COTTAGE_ID=80360
UPLISTING_ROSE_ID=82754
UPLISTING_PINOT_ID=82753

# Logging
LOG_LEVEL=info
```

---

## ⚠️ **SECURITY CHECKLIST**

Before deploying, verify:

- [ ] All secrets are at least 32 characters (64 hex)
- [ ] Password is at least 12 characters with mixed case/numbers/symbols
- [ ] Bcrypt hash uses 12+ rounds
- [ ] Different secrets for development and production
- [ ] No secrets committed to Git
- [ ] All values stored in Render.com environment variables
- [ ] Admin password saved in password manager
- [ ] Stripe production keys (not test keys)
- [ ] New Uplisting API key generated

---

## 📝 **WHERE TO ADD THESE SECRETS**

### **Render.com Dashboard:**
1. Go to your service in Render.com
2. Click **Environment** in the left sidebar
3. Click **Add Environment Variable**
4. Add each variable one by one
5. Click **Save Changes**
6. Service will automatically redeploy

### **Never put secrets in:**
- ❌ `.env` files in Git
- ❌ Source code files
- ❌ Public repositories
- ❌ Email or chat messages
- ❌ Text files on desktop

---

## 🆘 **TROUBLESHOOTING**

### **"bcryptjs not found" error:**
```bash
npm install bcryptjs
```

### **"crypto not found" error:**
Crypto is built into Node.js. Make sure you have Node.js installed:
```bash
node --version
```

### **Password hash not working:**
- Ensure you're using the hash (starts with `$2a$`) in environment variables
- Use the original password to log in, not the hash
- Verify bcrypt rounds is 12

### **Secrets not loading:**
- Check Render.com environment variables are saved
- Ensure no trailing spaces in values
- Restart the service after adding variables

---

## 🎯 **QUICK COMMAND SUMMARY**

```bash
# Generate all secrets at once
node generate-secrets.js

# Generate individual secrets
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Generate bcrypt hash
node generate-bcrypt-hash.js

# Test your setup
node -e "console.log('Node version:', process.version)"
```

**Your production deployment is now secure! 🚀**