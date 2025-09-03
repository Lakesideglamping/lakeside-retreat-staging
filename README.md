# Lakeside Retreat - Staging Environment

## Deployment-Ready Single Page Application

This is a streamlined version of the Lakeside Retreat website optimized for deployment on platforms like Render.

### Features
- Single Page Application with client-side navigation
- Optimized server configuration for deployment
- All necessary deployment files included

### Files Structure
- `index.html` - Main application file
- `server.js` - Express server for deployment
- `package.json` - Node.js dependencies
- `render.yaml` - Render deployment configuration
- `images/` - Website images

### Deployment
This application is ready to deploy to Render or similar platforms. The server.js handles:
- Static file serving
- SPA routing (serves index.html for all routes)
- Health check endpoint at `/health`

### Local Testing
```bash
npm install
npm start
```

The application will run on http://localhost:10000