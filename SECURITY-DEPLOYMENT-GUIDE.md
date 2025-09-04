# 🔒 LAKESIDE RETREAT - SECURITY DEPLOYMENT GUIDE

## ⚠️ **CRITICAL SECURITY NOTICE**

**The exposed Uplisting API key `418652ad-deca-48b2-9ea6-95d0b5ce258e` has been removed from this codebase.**

### **IMMEDIATE ACTIONS REQUIRED:**

1. **LOG INTO UPLISTING DASHBOARD IMMEDIATELY**
   - Go to your Uplisting account settings
   - Navigate to API Keys section  
   - **REVOKE** the API key: `418652ad-deca-48b2-9ea6-95d0b5ce258e`
   - **GENERATE** a new API key for production use

2. **GENERATE NEW PRODUCTION SECRETS**
   ```bash
   # Generate JWT Secret (64 characters)
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   
   # Generate Session Secret (64 characters)  
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   
   # Generate Admin Password Hash
   node -e "const bcrypt = require('bcryptjs'); console.log(bcrypt.hashSync('YOUR_STRONG_PASSWORD', 12))"
   ```

3. **CONFIGURE RENDER.COM ENVIRONMENT VARIABLES**

   In your Render.com service dashboard, set these environment variables:

   ### **Required Production Variables:**
   ```
   NODE_ENV=production
   PORT=10000
   TRUST_PROXY=true
   
   # Security (use generated values above)
   JWT_SECRET=your_generated_64_char_secret
   SESSION_SECRET=your_generated_64_char_secret
   
   # Admin Auth (use strong values)
   ADMIN_USERNAME=your_unique_admin_username
   ADMIN_PASSWORD_HASH=your_generated_bcrypt_hash
   JWT_EXPIRY=1h
   
   # Database
   DATABASE_URL=sqlite:./lakeside.db
   LOGIN_RATE_LIMIT_ATTEMPTS=3
   LOGIN_RATE_LIMIT_WINDOW_MINUTES=15
   BCRYPT_ROUNDS=12
   
   # Stripe (use production keys)
   STRIPE_SECRET_KEY=sk_live_your_production_key
   STRIPE_PUBLIC_KEY=pk_live_your_production_key  
   STRIPE_WEBHOOK_SECRET=whsec_your_production_webhook_secret
   
   # Uplisting (use NEW API key from step 1)
   UPLISTING_API_KEY=your_new_uplisting_api_key
   UPLISTING_WEBHOOK_SECRET=generate_new_webhook_secret
   UPLISTING_API_URL=https://api.uplisting.io/v1
   UPLISTING_SYNC_ENABLED=true
   UPLISTING_TIMEOUT=10000
   UPLISTING_RETRY_ATTEMPTS=3
   
   # Property IDs (verify these are correct)
   UPLISTING_COTTAGE_ID=80360
   UPLISTING_ROSE_ID=82754
   UPLISTING_PINOT_ID=82753
   
   # Logging
   LOG_LEVEL=info
   ```

## 🛡️ **SECURITY CHECKLIST**

Before deployment, verify:

- [ ] **API Key Revoked**: Old Uplisting API key is revoked
- [ ] **New API Key**: New Uplisting API key generated and configured
- [ ] **Strong Secrets**: All JWT/Session secrets are 64+ characters
- [ ] **Admin Password**: Strong admin password with bcrypt hash
- [ ] **Production Stripe**: Live Stripe keys configured (not test keys)
- [ ] **Environment Variables**: All variables set in Render.com (not in files)
- [ ] **No Secrets in Code**: No hardcoded secrets in any files
- [ ] **HTTPS Only**: SSL/TLS enabled in production
- [ ] **Rate Limiting**: Production rate limits configured

## 🚨 **WHAT WAS FIXED**

### **Security Issues Resolved:**
1. ✅ **Removed exposed Uplisting API key** from all environment files
2. ✅ **Sanitized all .env files** to remove production secrets  
3. ✅ **Created secure environment templates** for production deployment
4. ✅ **Updated placeholders** to prevent accidental secret exposure
5. ✅ **Added security deployment guide** with proper procedures

### **Files Cleaned:**
- `lakeside-minimal/.env` - Removed API keys
- `lakeside-retreat-backend/.env` - Created secure template
- Root `.env` - Sanitized Stripe test keys
- Created secure templates for production

## 📋 **DEPLOYMENT STEPS**

1. **Set Environment Variables in Render.com**
   - Use values from checklist above
   - Do NOT copy values from any .env files

2. **Deploy to Render**
   - Push clean code to GitHub
   - Deploy from lakeside-staging directory
   - Verify environment variables are loaded

3. **Test Deployment**
   - Check `/api/health` endpoint
   - Test admin login with new credentials
   - Verify Stripe integration (with production keys)
   - Test Uplisting webhook (with new API key)

4. **Monitor Security**
   - Check server logs for any errors
   - Monitor for unusual API requests
   - Verify rate limiting is working

## 🔐 **ONGOING SECURITY**

### **Best Practices:**
- ✅ Never commit secrets to version control
- ✅ Rotate API keys quarterly  
- ✅ Monitor access logs regularly
- ✅ Use environment variables for all secrets
- ✅ Keep dependencies updated
- ✅ Regular security audits

### **Emergency Contacts:**
- **Uplisting Support**: [support@uplisting.com]
- **Stripe Support**: [support@stripe.com]
- **Render Support**: [support@render.com]

---

## ⚡ **QUICK START**

```bash
# 1. Go to Uplisting Dashboard → API Keys → Revoke old key → Generate new key
# 2. Go to Render.com → Your Service → Environment → Add all variables above
# 3. Deploy from GitHub (lakeside-staging branch)
# 4. Test at: https://your-service.onrender.com/api/health
```

**🎯 Your deployment is now secure and ready for production!**