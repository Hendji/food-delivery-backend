const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8000;

// Middleware
app.use(cors());
app.use(express.json());

// PostgreSQL подключение
let pool;
try {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });
  console.log('✅ PostgreSQL настройки загружены');
} catch (error) {
  console.error('❌ Ошибка настройки PostgreSQL:', error);
}

// Проверка соединения с базой
async function testConnection() {
  try {
    if (pool) {
      const client = await pool.connect();
      console.log('✅ Подключено к PostgreSQL успешно!');
      client.release();
    } else {
      console.log('⚠️ Pool не инициализирован');
    }
  } catch (err) {
    console.error('❌ Ошибка подключения к PostgreSQL:', err.message);
  }
}

// Простые маршруты для тестирования
app.get('/', (req, res) => {
  res.json({
    message: '🚀 Food Delivery API работает!',
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
    database: pool ? 'connected' : 'disconnected'
  });
});

// Маршрут регистрации (упрощенный)
app.post('/register', async (req, res) => {
  try {
    const { name, email, password, phone } = req.body;

    console.log('📝 Регистрация:', { name, email });

    // Проверка обязательных полей
    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Заполните все обязательные поля'
      });
    }

    // Если нет базы данных, возвращаем мок-данные
    if (!pool) {
      return res.json({
        success: true,
        message: 'Регистрация успешна (тестовый режим)',
        access_token: 'mock_token_' + Date.now(),
        user: {
          id: 1,
          name,
          email,
          phone: phone || null,
          avatarUrl: null,
          createdAt: new Date().toISOString()
        }
      });
    }

    // Реальный код для работы с базой
    // ... (будет добавлен позже)

  } catch (error) {
    console.error('Ошибка регистрации:', error);
    res.status(500).json({
      success: false,
      error: 'Ошибка сервера'
    });
  }
});

// Маршрут входа
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    console.log('🔐 Вход:', { email });

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Введите email и пароль'
      });
    }

    // Мок-данные для тестирования
    res.json({
      success: true,
      message: 'Вход выполнен успешно',
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

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Ошибка сервера'
    });
  }
});

// Получение данных пользователя
app.get('/users/me', (req, res) => {
  res.json({
    id: 1,
    name: 'Иван Иванов',
    email: 'ivan@example.com',
    phone: '+7 (999) 123-45-67',
    avatarUrl: null,
    createdAt: new Date().toISOString()
  });
});

// Статистика заказов
app.get('/users/me/stats', (req, res) => {
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
          dish_description: 'Пицца с колбасками пепперони',
          dish_price: 600.0,
          dish_image: 'https://images.unsplash.com/photo-1628840042765-356cda07504e?w=400',
          ingredients: ['Тесто', 'Пепперони', 'Сыр'],
          quantity: 2
        }
      ],
      payment_method: 'Картой онлайн'
    }
  ];

  res.json({ orders: mockOrders });
});

// Запуск сервера
  console.log(`\n🚀 Сервер запущен!`);
  console.log(`📡 Локальный URL: http://localhost:${PORT}`);
  console.log(`🌐 Для Flutter: http://10.0.2.2:${PORT} (Android эмулятор)`);

  // Тестируем подключение к базе
});

// Функция инициализации базы данных
async function initializeDatabase() {
  try {
    if (!pool) {
      console.log('⚠️ Нет подключения к базе, пропускаем инициализацию');
      return;
    }

    const client = await pool.connect();

    // Проверяем существование таблиц
    const checkTables = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);

    console.log(`📊 Найдено таблиц: ${checkTables.rows.length}`);

    // Если таблиц нет, создаем их
    if (checkTables.rows.length === 0) {
      console.log('🔧 Инициализируем базу данных...');

      // Здесь можно выполнить SQL из init.sql
      // Для простоты создадим только users если нет
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

      console.log('✅ База данных инициализирована');
    }

    client.release();
  } catch (error) {
    console.error('❌ Ошибка инициализации базы:', error.message);
  }
}