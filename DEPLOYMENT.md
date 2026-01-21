# VNIBB Deployment Guide

## Prerequisites

- Docker and Docker Compose v2+
- PostgreSQL database (or use Supabase)
- Domain with SSL certificate (for production)
- Node.js 20+ (for local development)
- Python 3.11+ (for local development)

## Environment Variables

### Backend (.env)

```bash
# Database
DATABASE_URL=postgresql+asyncpg://user:password@host:5432/vnibb
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-service-role-key

# Redis (optional, for caching)
REDIS_URL=redis://localhost:6379/0

# VNStock Premium (optional)
VNSTOCK_API_KEY=your-vnstock-api-key

# AI Features (optional)
GOOGLE_API_KEY=your-google-api-key

# Environment
ENVIRONMENT=production
DEBUG=false
```

### Frontend (.env.local)

```bash
# API
NEXT_PUBLIC_API_URL=https://api.yourdomain.com

# Supabase Auth
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

## Local Development

### Backend

```bash
cd backend
pip install -e ".[dev]"
uvicorn vnibb.api.main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

## Docker Deployment

### Development

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

### Production

```bash
# Build and start with production config
docker-compose -f docker-compose.prod.yml up -d

# Run database migrations
docker-compose exec api alembic upgrade head

# Seed initial data (optional)
docker-compose exec api python -m vnibb.cli.seed
```

## Database Setup

### Run Migrations

```bash
cd backend
alembic upgrade head
```

### Create New Migration

```bash
alembic revision --autogenerate -m "description"
```

## Health Checks

- Backend: `GET /health`
- Frontend: `GET /`

## Monitoring

### Logs

```bash
# Backend logs
docker-compose logs -f api

# All services
docker-compose logs -f
```

### Metrics

The backend exposes Prometheus metrics at `/metrics` (when enabled).

## Troubleshooting

### Common Issues

1. **Database connection failed**
   - Check DATABASE_URL format
   - Verify PostgreSQL is running
   - Check network connectivity

2. **VNStock API errors**
   - Verify VNSTOCK_API_KEY is valid
   - Check rate limits
   - Fallback to free tier if needed

3. **Frontend build errors**
   - Clear `.next` folder
   - Delete `node_modules` and reinstall
   - Check TypeScript errors with `npm run build`

4. **CORS errors**
   - Verify allowed origins in backend config
   - Check API URL in frontend env

## Security Checklist

- [ ] Use HTTPS in production
- [ ] Set strong database passwords
- [ ] Enable rate limiting
- [ ] Configure CORS properly
- [ ] Use environment variables for secrets
- [ ] Enable Supabase RLS policies
- [ ] Regular security updates

## Scaling

### Horizontal Scaling

- Use load balancer for multiple API instances
- Configure Redis for session sharing
- Use CDN for static assets

### Database Scaling

- Enable connection pooling (PgBouncer)
- Configure read replicas for heavy read loads
- Regular VACUUM and index maintenance
