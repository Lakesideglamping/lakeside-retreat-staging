# Lakeside Retreat Website

Central Otago luxury glamping accommodation website.

## 🏔️ Features

- **Single HTML file** - Complete website in one file for fast loading
- **Express.js backend** - Secure static file serving with proper headers
- **Optimized images** - All images under 400KB for fast loading
- **Railway deployment** - Easy deployment to Railway.app
- **SEO optimized** - Proper meta tags and structured data

## 🚀 Deployment

### Railway (Recommended)
1. Connect this GitHub repository to Railway
2. Deploy automatically - no configuration needed
3. Railway will run `npm start` and serve on the assigned port

### Local Development
```bash
npm install
npm start
# Visit http://localhost:3000
```

## 📁 Structure

```
├── server.js          # Express server
├── index.html         # Complete website
├── package.json       # Dependencies
├── images/            # Optimized images only
└── railway.toml       # Railway configuration
```

## 🔧 Health Check

Visit `/api/health` to check if the server is running.

## 🌐 Live Site

https://lakesideretreat.co.nz