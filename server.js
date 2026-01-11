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

    // Таблица блюд
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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    log('✅ Таблица dishes создана/проверена');

    // Таблица заказов
    await client.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        restaurant_id INTEGER REFERENCES restaurants(id),
        restaurant_name VARCHAR(100),
        restaurant_image TEXT,
        total_amount DECIMAL(10,2) NOT NULL,
        status VARCHAR(50) DEFAULT 'pending',
        delivery_address TEXT NOT NULL,
        payment_method VARCHAR(50),
        order_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    log('✅ Таблица orders создана/проверена');

    // Таблица элементов заказа
    await client.query(`
      CREATE TABLE IF NOT EXISTS order_items (
        id SERIAL PRIMARY KEY,
        order_id INTEGER REFERENCES orders(id),
        dish_id INTEGER REFERENCES dishes(id),
        dish_name VARCHAR(100),
        dish_price DECIMAL(10,2),
        quantity INTEGER DEFAULT 1
      )
    `);

    log('✅ Таблица order_items создана/проверена');

    client.release();

  } catch (error) {
    log(`❌ Ошибка создания таблиц: ${error.message}`);
  }
}

// ===== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ =====

// Функция для получения ID пользователя из токена (упрощенная версия)
function getUserIdFromToken(req) {
  // В реальном приложении здесь должна быть проверка JWT токена
  // Для упрощения будем использовать заголовок X-User-Id
  const userId = req.headers['x-user-id'];

  if (userId && !isNaN(parseInt(userId))) {
    return parseInt(userId);
  }

  // Если заголовка нет, используем токен из Authorization
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token && token.startsWith('token_')) {
    // Извлекаем ID из токена (в демо-режиме)
    const tokenParts = token.split('_');
    if (tokenParts.length > 1 && !isNaN(parseInt(tokenParts[1]))) {
      return parseInt(tokenParts[1]);
    }
  }

  // Если ничего не найдено, возвращаем null
  return null;
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
               RETURNING id, name, email, phone, avatar_url, created_at`,
            [name, email, password, phone || null]
        );

        const user = newUser.rows[0];

        // Генерируем токен с ID пользователя
        const token = `token_${user.id}_${Date.now()}`;

        res.json({
          success: true,
          message: 'Регистрация успешна',
          access_token: token,
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

        // Генерируем токен с ID пользователя
        const token = `token_${user.id}_${Date.now()}`;

        res.json({
          success: true,
          message: 'Вход выполнен успешно',
          access_token: token,
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
    access_token: 'mock_token_1_' + Date.now(), // ID = 1 для демо
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
    const userId = getUserIdFromToken(req);

    if (!userId) {
      return res.status(401).json({
        error: 'Требуется авторизация'
      });
    }

    // Если база подключена, получаем данные из БД
    if (isDatabaseConnected && pool) {
      try {
        const userResult = await pool.query(
            'SELECT id, name, email, phone, avatar_url, created_at FROM users WHERE id = $1',
            [userId]
        );

        if (userResult.rows.length === 0) {
          return res.status(404).json({
            error: 'Пользователь не найден'
          });
        }

        const user = userResult.rows[0];

        res.json({
          id: user.id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          avatarUrl: user.avatar_url,
          createdAt: user.created_at
        });

      } catch (dbError) {
        log(`❌ Ошибка базы при получении пользователя: ${dbError.message}`);
        return res.status(500).json({
          error: 'Ошибка сервера'
        });
      }
    } else {
      // Мок-режим
      res.json({
        id: userId,
        name: 'Иван Иванов',
        email: 'ivan@example.com',
        phone: '+7 (999) 123-45-67',
        avatarUrl: null,
        createdAt: new Date().toISOString()
      });
    }

  } catch (error) {
    log(`❌ Ошибка получения пользователя: ${error.message}`);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Статистика заказов
app.get('/users/me/stats', async (req, res) => {
  try {
    const userId = getUserIdFromToken(req);

    if (!userId) {
      return res.status(401).json({
        error: 'Требуется авторизация'
      });
    }

    log(`📊 Запрос статистики для пользователя ${userId}`);

    // Если база подключена, получаем статистику из БД
    if (isDatabaseConnected && pool) {
      try {
        // Общее количество заказов
        const totalOrdersResult = await pool.query(
            'SELECT COUNT(*) as count FROM orders WHERE user_id = $1',
            [userId]
        );

        const totalOrders = parseInt(totalOrdersResult.rows[0].count) || 0;

        // Доставленные заказы
        const deliveredOrdersResult = await pool.query(
            'SELECT COUNT(*) as count FROM orders WHERE user_id = $1 AND status = $2',
            [userId, 'delivered']
        );

        const deliveredOrders = parseInt(deliveredOrdersResult.rows[0].count) || 0;

        // Заказы в обработке
        const pendingOrdersResult = await pool.query(
            'SELECT COUNT(*) as count FROM orders WHERE user_id = $1 AND status = $2',
            [userId, 'pending']
        );

        const pendingOrders = parseInt(pendingOrdersResult.rows[0].count) || 0;

        // Общая сумма
        const totalSpentResult = await pool.query(
            'SELECT COALESCE(SUM(total_amount), 0) as total FROM orders WHERE user_id = $1',
            [userId]
        );

        const totalSpent = parseFloat(totalSpentResult.rows[0].total) || 0;

        // Средний чек
        const averageOrderValue = totalOrders > 0 ? Math.round(totalSpent / totalOrders) : 0;

        // Любимый ресторан
        const favoriteRestaurantResult = await pool.query(
            `SELECT restaurant_name, COUNT(*) as order_count 
           FROM orders 
           WHERE user_id = $1 
           GROUP BY restaurant_name 
           ORDER BY order_count DESC, restaurant_name 
           LIMIT 1`,
            [userId]
        );

        const favoriteRestaurant = favoriteRestaurantResult.rows.length > 0
            ? favoriteRestaurantResult.rows[0].restaurant_name
            : null;

        res.json({
          total_orders: totalOrders,
          delivered_orders: deliveredOrders,
          pending_orders: pendingOrders,
          total_spent: totalSpent,
          average_order_value: averageOrderValue,
          favorite_restaurant: favoriteRestaurant
        });

      } catch (dbError) {
        log(`❌ Ошибка базы при получении статистики: ${dbError.message}`);
        return res.status(500).json({
          error: 'Ошибка сервера'
        });
      }
    } else {
      // Мок-режим (только для пользователя с ID=1)
      if (userId === 1) {
        res.json({
          total_orders: 5,
          delivered_orders: 4,
          pending_orders: 1,
          total_spent: 4500,
          average_order_value: 900,
          favorite_restaurant: 'Пицца Мания'
        });
      } else {
        // Для новых пользователей пустая статистика
        res.json({
          total_orders: 0,
          delivered_orders: 0,
          pending_orders: 0,
          total_spent: 0,
          average_order_value: 0,
          favorite_restaurant: null
        });
      }
    }

  } catch (error) {
    log(`❌ Ошибка получения статистики: ${error.message}`);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// История заказов
app.get('/users/me/orders', async (req, res) => {
  try {
    const userId = getUserIdFromToken(req);

    if (!userId) {
      return res.status(401).json({
        error: 'Требуется авторизация'
      });
    }

    log(`📦 Запрос истории заказов для пользователя ${userId}`);

    // Если база подключена, получаем заказы из БД
    if (isDatabaseConnected && pool) {
      try {
        // Получаем основные данные заказов
        const ordersResult = await pool.query(
            `SELECT o.*, 
           json_agg(
             json_build_object(
               'dish_id', oi.dish_id,
               'dish_name', oi.dish_name,
               'dish_price', oi.dish_price,
               'quantity', oi.quantity
             )
           ) as items
           FROM orders o
           LEFT JOIN order_items oi ON o.id = oi.order_id
           WHERE o.user_id = $1
           GROUP BY o.id
           ORDER BY o.order_date DESC`,
            [userId]
        );

        // Форматируем ответ
        const orders = ordersResult.rows.map(order => ({
          id: order.id.toString(),
          restaurant_name: order.restaurant_name,
          restaurant_image: order.restaurant_image,
          order_date: order.order_date.toISOString(),
          total_amount: parseFloat(order.total_amount),
          status: order.status,
          delivery_address: order.delivery_address,
          payment_method: order.payment_method,
          items: order.items || []
        }));

        res.json({ orders });

      } catch (dbError) {
        log(`❌ Ошибка базы при получении заказов: ${dbError.message}`);

        // В случае ошибки БД возвращаем пустой массив
        res.json({ orders: [] });
      }
    } else {
      // Мок-режим (только для пользователя с ID=1)
      if (userId === 1) {
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
      } else {
        // Для новых пользователей пустая история
        res.json({ orders: [] });
      }
    }

  } catch (error) {
    log(`❌ Ошибка получения заказов: ${error.message}`);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
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