const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8000;

// Middleware
app.use(cors());
app.use(express.json());

// Функция для логирования (полезно для дебага)
function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

// PostgreSQL подключение
let pool;
let isDatabaseConnected = false;

// Функция инициализации подключения к базе
async function initializeDatabase() {
  try {
    const databaseUrl = process.env.DATABASE_URL;

    log(`🔍 Проверяем DATABASE_URL: ${databaseUrl ? 'присутствует' : 'отсутствует'}`);

    if (!databaseUrl) {
      log('⚠️ DATABASE_URL не найден. Используем мок-режим.');
      return;
    }

    log('🔗 Настраиваем подключение к PostgreSQL...');

    pool = new Pool({
      connectionString: databaseUrl,
      ssl: {
        rejectUnauthorized: false
      },
      max: 5, // максимальное количество клиентов в пуле
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000
    });

    // Тестируем подключение
    const client = await pool.connect();
    log('✅ PostgreSQL подключен успешно!');
    client.release();
    isDatabaseConnected = true;

    // Создаем таблицы если их нет
    await createTablesIfNotExist();

  } catch (error) {
    log(`❌ Ошибка подключения к PostgreSQL: ${error.message}`);
    log('📝 Приложение будет работать в мок-режиме без базы данных');
    isDatabaseConnected = false;
  }
}

// Функция создания таблиц
async function createTablesIfNotExist() {
  if (!isDatabaseConnected) return;

  try {
    const client = await pool.connect();

    // Таблица пользователей
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        phone VARCHAR(20),
        avatar_url TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    log('✅ Таблица users создана/проверена');

    // Таблица ресторанов
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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    log('✅ Таблица restaurants создана/проверена');

    client.release();

  } catch (error) {
    log(`❌ Ошибка создания таблиц: ${error.message}`);
  }
}

// ===== МАРШРУТЫ API =====

app.get('/', (req, res) => {
  res.json({
    message: '🚀 Food Delivery API работает!',
    status: 'ok',
    database: isDatabaseConnected ? 'connected' : 'mock-mode',
    endpoints: {
      health: '/health',
      register: '/register (POST)',
      login: '/login (POST)',
      user: '/users/me (GET)',
      stats: '/users/me/stats (GET)',
      orders: '/users/me/orders (GET)'
    }
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    database: isDatabaseConnected ? 'connected' : 'mock-mode',
    environment: process.env.NODE_ENV || 'development'
  });
});

// Регистрация пользователя
app.post('/register', async (req, res) => {
  try {
    const { name, email, password, phone } = req.body;

    log(`📝 Регистрация: ${name} (${email})`);

    // Валидация
    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Заполните все обязательные поля'
      });
    }

    // Если база подключена, сохраняем в базу
    if (isDatabaseConnected && pool) {
      try {
        // Проверяем существующего пользователя
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

        // Создаем нового пользователя
        const newUser = await pool.query(
            `INSERT INTO users (name, email, password, phone) 
           VALUES ($1, $2, $3, $4) 
           RETURNING id, name, email, phone, created_at`,
            [name, email, password, phone || null]
        );

        const user = newUser.rows[0];

        res.json({
          success: true,
          message: 'Регистрация успешна',
          access_token: 'token_' + Date.now(),
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            phone: user.phone,
            avatarUrl: user.avatar_url,
            createdAt: user.created_at
          }
        });

      } catch (dbError) {
        log(`❌ Ошибка базы при регистрации: ${dbError.message}`);
        // Если ошибка базы, возвращаем мок-данные
        return sendMockRegistration(res, name, email, phone);
      }
    } else {
      // Мок-режим
      sendMockRegistration(res, name, email, phone);
    }

  } catch (error) {
    log(`❌ Ошибка регистрации: ${error.message}`);
    res.status(500).json({
      success: false,
      error: 'Ошибка сервера'
    });
  }
});

// Функция для мок-регистрации
function sendMockRegistration(res, name, email, phone) {
  res.json({
    success: true,
    message: 'Регистрация успешна (тестовый режим)',
    access_token: 'mock_token_' + Date.now(),
    user: {
      id: Date.now(),
      name,
      email,
      phone: phone || null,
      avatarUrl: null,
      createdAt: new Date().toISOString()
    }
  });
}

// Вход пользователя
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    log(`🔐 Вход: ${email}`);

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Введите email и пароль'
      });
    }

    // Если база подключена, ищем пользователя
    if (isDatabaseConnected && pool) {
      try {
        const userResult = await pool.query(
            'SELECT * FROM users WHERE email = $1 AND password = $2',
            [email, password]
        );

        if (userResult.rows.length === 0) {
          return res.status(401).json({
            success: false,
            error: 'Неверный email или пароль'
          });
        }

        const user = userResult.rows[0];

        res.json({
          success: true,
          message: 'Вход выполнен успешно',
          access_token: 'token_' + Date.now(),
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            phone: user.phone,
            avatarUrl: user.avatar_url,
            createdAt: user.created_at
          }
        });

      } catch (dbError) {
        log(`❌ Ошибка базы при входе: ${dbError.message}`);
        // Если ошибка базы, возвращаем мок-данные
        return sendMockLogin(res, email);
      }
    } else {
      // Мок-режим
      sendMockLogin(res, email);
    }

  } catch (error) {
    log(`❌ Ошибка входа: ${error.message}`);
    res.status(500).json({
      success: false,
      error: 'Ошибка сервера'
    });
  }
});

// Функция для мок-входа
function sendMockLogin(res, email) {
  res.json({
    success: true,
    message: 'Вход выполнен успешно (тестовый режим)',
    access_token: 'mock_token_' + Date.now(),
    user: {
      id: 1,
      name: 'Иван Иванов',
      email: email,
      phone: '+7 (999) 123-45-67',
      avatarUrl: null,
      createdAt: new Date().toISOString()
    }
  });
}

// Получение данных текущего пользователя
app.get('/users/me', async (req, res) => {
  try {
    // В реальном приложении проверяем токен из заголовков
    const token = req.headers.authorization?.replace('Bearer ', '');

    log(`👤 Получение данных пользователя, токен: ${token ? 'есть' : 'нет'}`);

    // Мок-данные
    res.json({
      id: 1,
      name: 'Иван Иванов',
      email: 'ivan@example.com',
      phone: '+7 (999) 123-45-67',
      avatarUrl: null,
      createdAt: new Date().toISOString()
    });

  } catch (error) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Статистика заказов
app.get('/users/me/stats', (req, res) => {
  log('📊 Запрос статистики');
  res.json({
    total_orders: 5,
    delivered_orders: 4,
    pending_orders: 1,
    total_spent: 4500,
    average_order_value: 900,
    favorite_restaurant: 'Пицца Мания'
  });
});

// История заказов
app.get('/users/me/orders', (req, res) => {
  log('📦 Запрос истории заказов');

  const mockOrders = [
    {
      id: '100',
      restaurant_name: 'Пицца Мания',
      restaurant_image: 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=400',
      order_date: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      total_amount: 1200.0,
      status: 'delivered',
      delivery_address: 'ул. Ленина, д. 10, кв. 5',
      items: [
        {
          dish_id: 'p1',
          dish_name: 'Пепперони',
          dish_description: 'Пицца с колбасками пепперони и сыром моцарелла',
          dish_price: 600.0,
          dish_image: 'https://images.unsplash.com/photo-1628840042765-356cda07504e?w=400',
          ingredients: ['Тесто', 'Томатный соус', 'Пепперони', 'Моцарелла'],
          preparation_time: 25,
          quantity: 2
        }
      ],
      payment_method: 'Картой онлайн'
    },
    {
      id: '101',
      restaurant_name: 'Бургер Кинг',
      restaurant_image: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=400',
      order_date: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      total_amount: 749.0,
      status: 'delivered',
      delivery_address: 'ул. Ленина, д. 10, кв. 5',
      items: [
        {
          dish_id: 'b1',
          dish_name: 'Чизбургер',
          dish_description: 'Классический бургер с сыром',
          dish_price: 299.0,
          dish_image: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=400',
          ingredients: ['Булочка', 'Говяжья котлета', 'Сыр', 'Лук', 'Кетчуп'],
          preparation_time: 15,
          quantity: 1
        },
        {
          dish_id: 'b3',
          dish_name: 'Картофель фри',
          dish_description: 'Хрустящий картофель фри',
          dish_price: 149.0,
          dish_image: 'https://images.unsplash.com/photo-1573080496219-bb080dd4f877?w=400',
          ingredients: ['Картофель', 'Растительное масло', 'Соль'],
          preparation_time: 10,
          is_vegetarian: true,
          quantity: 3
        }
      ],
      payment_method: 'Наличными'
    }
  ];

  res.json({ orders: mockOrders });
});

// ===== ЗАПУСК СЕРВЕРА =====

async function startServer() {
  try {
    // Инициализируем базу данных
    await initializeDatabase();

    // Запускаем сервер
    app.listen(PORT, () => {
      log(`\n🚀 Сервер запущен!`);
      log(`📡 Порт: ${PORT}`);
      log(`🌐 Режим базы: ${isDatabaseConnected ? '✅ Подключена' : '⚠️ Мок-режим'}`);
      log(`🔧 NODE_ENV: ${process.env.NODE_ENV || 'development'}`);

      // Показываем URL для доступа
      if (process.env.RAILWAY_STATIC_URL) {
        log(`🌍 Railway URL: ${process.env.RAILWAY_STATIC_URL}`);
      } else if (process.env.NODE_ENV === 'production') {
        log(`🌍 Production mode`);
      } else {
        log(`🌍 Local URL: http://localhost:${PORT}`);
        log(`📱 Для Flutter: http://10.0.2.2:${PORT}`);
      }
    });

  } catch (error) {
    log(`❌ Критическая ошибка запуска: ${error.message}`);
    process.exit(1);
  }
}

// Запускаем сервер
startServer();