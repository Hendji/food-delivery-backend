const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8000;

// ===== МИДЛВЭЙРЫ БЕЗОПАСНОСТИ =====
app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*',
  credentials: true
}));
app.use(express.json());

// Лимит запросов
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 минут
  max: 100 // лимит запросов с одного IP
});
app.use('/api/', limiter);

// ===== КОНФИГУРАЦИЯ =====
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this';
const ADMIN_API_KEY = process.env.ADMIN_API_KEY;

// ===== БАЗА ДАННЫХ =====
let pool;
let isDatabaseConnected = false;

async function initializeDatabase() {
  try {
    const databaseUrl = process.env.DATABASE_URL;

    if (!databaseUrl) {
      console.log('⚠️ DATABASE_URL не найден. Используем мок-режим.');
      return;
    }

    pool = new Pool({
      connectionString: databaseUrl,
      ssl: { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000
    });

    const client = await pool.connect();
    console.log('✅ PostgreSQL подключен успешно!');
    client.release();
    isDatabaseConnected = true;

    await createTablesIfNotExist();
  } catch (error) {
    console.error(`❌ Ошибка подключения к PostgreSQL: ${error.message}`);
    isDatabaseConnected = false;
  }
}

async function createTablesIfNotExist() {
  if (!isDatabaseConnected) return;

  try {
    const client = await pool.connect();

    // Таблица пользователей (обновленная)
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        phone VARCHAR(20),
        avatar_url TEXT,
        role VARCHAR(20) DEFAULT 'user',
        is_active BOOLEAN DEFAULT true,
        telegram_chat_id BIGINT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Таблица ресторанов (добавлены поля для админ-управления)
    await client.query(`
      CREATE TABLE IF NOT EXISTS restaurants (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        description TEXT,
        image_url TEXT,
        rating DECIMAL(3,2) DEFAULT 0.0,
        delivery_time VARCHAR(50),
        delivery_price VARCHAR(50),
        categories TEXT[],
        is_active BOOLEAN DEFAULT true,
        contact_phone VARCHAR(20),
        address TEXT,
        admin_notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Таблица блюд (добавлены поля для админ-управления)
    await client.query(`
      CREATE TABLE IF NOT EXISTS dishes (
        id SERIAL PRIMARY KEY,
        restaurant_id INTEGER REFERENCES restaurants(id),
        name VARCHAR(100) NOT NULL,
        description TEXT,
        image_url TEXT,
        price DECIMAL(10,2) NOT NULL,
        ingredients TEXT[],
        preparation_time INTEGER,
        is_vegetarian BOOLEAN DEFAULT false,
        is_spicy BOOLEAN DEFAULT false,
        is_available BOOLEAN DEFAULT true,
        sort_order INTEGER DEFAULT 0,
        admin_notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Таблица изменений (для аудита)
    await client.query(`
      CREATE TABLE IF NOT EXISTS admin_audit_log (
        id SERIAL PRIMARY KEY,
        admin_id INTEGER REFERENCES users(id),
        action VARCHAR(50) NOT NULL,
        entity_type VARCHAR(50) NOT NULL,
        entity_id INTEGER,
        changes JSONB,
        ip_address VARCHAR(45),
        user_agent TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    client.release();
    console.log('✅ Все таблицы созданы/проверены');
  } catch (error) {
    console.error(`❌ Ошибка создания таблиц: ${error.message}`);
  }
}

// ===== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ =====

// Валидация JWT токена
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Требуется авторизация' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Неверный или просроченный токен' });
    }
    req.user = user;
    next();
  });
}

// Проверка роли админа
function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Требуются права администратора' });
  }
  next();
}

// Валидация API ключа админа
function validateAdminApiKey(req, res, next) {
  const apiKey = req.headers['x-admin-api-key'];

  if (!apiKey || apiKey !== ADMIN_API_KEY) {
    return res.status(401).json({ error: 'Неверный API ключ' });
  }
  next();
}

// ===== АУТЕНТИФИКАЦИЯ И ПОЛЬЗОВАТЕЛИ =====

// Регистрация
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password, phone } = req.body;

    // Валидация
    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Заполните все обязательные поля'
      });
    }

    // Хеширование пароля
    const passwordHash = await bcrypt.hash(password, 10);

    if (isDatabaseConnected && pool) {
      const existingUser = await pool.query(
          'SELECT * FROM users WHERE email = $1',
          [email]
      );

      if (existingUser.rows.length > 0) {
        return res.status(400).json({
          success: false,
          error: 'Пользователь с таким email уже существует'
        });
      }

      const newUser = await pool.query(
          `INSERT INTO users (name, email, password_hash, phone, role)
         VALUES ($1, $2, $3, $4, 'user')
         RETURNING id, name, email, phone, avatar_url, role, created_at`,
          [name, email, passwordHash, phone || null]
      );

      const user = newUser.rows[0];
      const token = jwt.sign(
          { id: user.id, email: user.email, role: user.role },
          JWT_SECRET,
          { expiresIn: '7d' }
      );

      res.json({
        success: true,
        access_token: token,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          role: user.role,
          avatarUrl: user.avatar_url
        }
      });
    } else {
      // Мок-режим
      res.json({
        success: true,
        access_token: 'mock_token_' + Date.now(),
        user: {
          id: Date.now(),
          name,
          email,
          phone: phone || null,
          role: 'user'
        }
      });
    }
  } catch (error) {
    console.error('Ошибка регистрации:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Вход
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Введите email и пароль'
      });
    }

    if (isDatabaseConnected && pool) {
      const userResult = await pool.query(
          'SELECT * FROM users WHERE email = $1 AND is_active = true',
          [email]
      );

      if (userResult.rows.length === 0) {
        return res.status(401).json({
          success: false,
          error: 'Неверный email или пароль'
        });
      }

      const user = userResult.rows[0];
      const validPassword = await bcrypt.compare(password, user.password_hash);

      if (!validPassword) {
        return res.status(401).json({
          success: false,
          error: 'Неверный email или пароль'
        });
      }

      const token = jwt.sign(
          { id: user.id, email: user.email, role: user.role },
          JWT_SECRET,
          { expiresIn: '7d' }
      );

      res.json({
        success: true,
        access_token: token,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          role: user.role,
          avatarUrl: user.avatar_url
        }
      });
    } else {
      // Мок-режим
      res.json({
        success: true,
        access_token: 'mock_token_1_' + Date.now(),
        user: {
          id: 1,
          name: 'Иван Иванов',
          email: email,
          phone: '+7 (999) 123-45-67',
          role: 'user'
        }
      });
    }
  } catch (error) {
    console.error('Ошибка входа:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ===== АДМИН API (требует JWT и роль admin) =====

// Получение списка ресторанов (для админа)
app.get('/api/admin/restaurants', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
        `SELECT * FROM restaurants 
       ORDER BY created_at DESC`
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Ошибка получения ресторанов:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Создание/обновление ресторана
app.post('/api/admin/restaurants', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const {
      id, name, description, image_url,
      delivery_time, delivery_price, categories,
      contact_phone, address, is_active
    } = req.body;

    let result;
    if (id) {
      // Обновление
      result = await pool.query(
          `UPDATE restaurants 
         SET name = $1, description = $2, image_url = $3,
             delivery_time = $4, delivery_price = $5, categories = $6,
             contact_phone = $7, address = $8, is_active = $9,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $10
         RETURNING *`,
          [name, description, image_url, delivery_time, delivery_price,
            categories, contact_phone, address, is_active, id]
      );
    } else {
      // Создание
      result = await pool.query(
          `INSERT INTO restaurants 
         (name, description, image_url, delivery_time, delivery_price,
          categories, contact_phone, address, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
          [name, description, image_url, delivery_time, delivery_price,
            categories, contact_phone, address, is_active || true]
      );
    }

    // Логирование действия
    await pool.query(
        `INSERT INTO admin_audit_log 
       (admin_id, action, entity_type, entity_id, changes)
       VALUES ($1, $2, $3, $4, $5)`,
        [req.user.id, id ? 'UPDATE' : 'CREATE', 'restaurant',
          result.rows[0].id, req.body]
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Ошибка сохранения ресторана:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Управление блюдами
app.get('/api/admin/restaurants/:restaurantId/dishes', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
        `SELECT * FROM dishes 
       WHERE restaurant_id = $1 
       ORDER BY sort_order, name`,
        [req.params.restaurantId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Ошибка получения блюд:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.post('/api/admin/dishes', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const {
      id, restaurant_id, name, description, image_url,
      price, ingredients, preparation_time,
      is_vegetarian, is_spicy, is_available, sort_order
    } = req.body;

    let result;
    if (id) {
      // Обновление
      result = await pool.query(
          `UPDATE dishes 
         SET name = $1, description = $2, image_url = $3,
             price = $4, ingredients = $5, preparation_time = $6,
             is_vegetarian = $7, is_spicy = $8, 
             is_available = $9, sort_order = $10,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $11
         RETURNING *`,
          [name, description, image_url, price, ingredients,
            preparation_time, is_vegetarian, is_spicy,
            is_available, sort_order, id]
      );
    } else {
      // Создание
      result = await pool.query(
          `INSERT INTO dishes 
         (restaurant_id, name, description, image_url, price,
          ingredients, preparation_time, is_vegetarian, is_spicy,
          is_available, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *`,
          [restaurant_id, name, description, image_url, price,
            ingredients, preparation_time, is_vegetarian, is_spicy,
            is_available || true, sort_order || 0]
      );
    }

    // Логирование
    await pool.query(
        `INSERT INTO admin_audit_log 
       (admin_id, action, entity_type, entity_id, changes)
       VALUES ($1, $2, $3, $4, $5)`,
        [req.user.id, id ? 'UPDATE' : 'CREATE', 'dish',
          result.rows[0].id, req.body]
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Ошибка сохранения блюда:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ===== ПУБЛИЧНЫЙ API (для приложения) =====

// Получение активных ресторанов
app.get('/api/restaurants', async (req, res) => {
  try {
    if (isDatabaseConnected && pool) {
      const result = await pool.query(
          `SELECT id, name, description, image_url, rating,
                delivery_time, delivery_price, categories
         FROM restaurants 
         WHERE is_active = true
         ORDER BY rating DESC`
      );
      res.json(result.rows);
    } else {
      // Мок-данные
      res.json([
        {
          id: 1,
          name: 'Пицца Мания',
          description: 'Итальянская кухня, пицца, паста',
          image_url: 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=400',
          rating: 4.7,
          delivery_time: '25-35 мин',
          delivery_price: 'Бесплатно',
          categories: ['Пицца', 'Итальянская', 'Паста']
        }
      ]);
    }
  } catch (error) {
    console.error('Ошибка получения ресторанов:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Получение меню ресторана
app.get('/api/restaurants/:id/menu', async (req, res) => {
  try {
    if (isDatabaseConnected && pool) {
      const result = await pool.query(
          `SELECT id, name, description, image_url, price,
                ingredients, preparation_time, 
                is_vegetarian, is_spicy
         FROM dishes 
         WHERE restaurant_id = $1 AND is_available = true
         ORDER BY sort_order, name`,
          [req.params.id]
      );
      res.json(result.rows);
    } else {
      // Мок-данные
      res.json([
        {
          id: 1,
          name: 'Пепперони',
          description: 'Пицца с колбасками пепперони и сыром моцарелла',
          image_url: 'https://images.unsplash.com/photo-1628840042765-356cda07504e?w=400',
          price: 699.00,
          ingredients: ['Тесто', 'Томатный соус', 'Пепперони', 'Моцарелла'],
          preparation_time: 25,
          is_vegetarian: false,
          is_spicy: false
        }
      ]);
    }
  } catch (error) {
    console.error('Ошибка получения меню:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ===== API ДЛЯ TELEGRAM БОТА (использует API ключ) =====

// Быстрое обновление доступности блюда
app.post('/api/bot/dish/:id/toggle', validateAdminApiKey, async (req, res) => {
  try {
    const result = await pool.query(
        `UPDATE dishes 
       SET is_available = NOT is_available,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING id, name, is_available`,
        [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Блюдо не найдено' });
    }

    res.json({
      success: true,
      dish: result.rows[0],
      message: `Блюдо "${result.rows[0].name}" теперь ${result.rows[0].is_available ? 'доступно' : 'недоступно'}`
    });
  } catch (error) {
    console.error('Ошибка обновления блюда:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Получение статистики для админа
app.get('/api/bot/stats', validateAdminApiKey, async (req, res) => {
  try {
    const [restaurants, dishes, orders] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM restaurants WHERE is_active = true'),
      pool.query('SELECT COUNT(*) FROM dishes WHERE is_available = true'),
      pool.query(`SELECT COUNT(*) FROM orders 
                  WHERE order_date >= NOW() - INTERVAL '24 hours'`)
    ]);

    res.json({
      active_restaurants: parseInt(restaurants.rows[0].count),
      available_dishes: parseInt(dishes.rows[0].count),
      orders_last_24h: parseInt(orders.rows[0].count)
    });
  } catch (error) {
    console.error('Ошибка получения статистики:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ===== ЗАПУСК СЕРВЕРА =====

async function startServer() {
  await initializeDatabase();

  app.listen(PORT, () => {
    console.log(`\n🚀 Сервер запущен!`);
    console.log(`📡 Порт: ${PORT}`);
    console.log(`🔐 Режим безопасности: Включен`);
    console.log(`🔧 JWT секрет: ${JWT_SECRET ? 'Установлен' : 'Отсутствует'}`);
    console.log(`🌍 URL: http://localhost:${PORT}`);
  });
}

startServer();