const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8000;

// Middleware
app.use(cors());
app.use(express.json());

// Функция для логирования
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
      max: 5,
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

    // Таблица пользователей с полем подтверждения email
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        phone VARCHAR(20),
        avatar_url TEXT,
        is_email_verified BOOLEAN DEFAULT false,
        email_verification_token VARCHAR(255),
        email_verification_expires TIMESTAMP,
        password_reset_token VARCHAR(255),
        password_reset_expires TIMESTAMP,
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

// Генерация JWT токена
function generateToken(userId) {
  return jwt.sign(
      { userId },
      process.env.JWT_SECRET || 'your-secret-key-change-in-production',
      { expiresIn: '7d' }
  );
}

// Верификация JWT токена
function verifyToken(token) {
  try {
    return jwt.verify(
        token,
        process.env.JWT_SECRET || 'your-secret-key-change-in-production'
    );
  } catch (error) {
    return null;
  }
}

// Получение ID пользователя из токена
function getUserIdFromToken(req) {
  const token = req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    return null;
  }

  const decoded = verifyToken(token);
  return decoded ? decoded.userId : null;
}

// Хеширование пароля
async function hashPassword(password) {
  const saltRounds = 10;
  return await bcrypt.hash(password, saltRounds);
}

// Проверка пароля
async function comparePassword(password, hashedPassword) {
  return await bcrypt.compare(password, hashedPassword);
}

// Генерация случайного токена
function generateRandomToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Отправка email (мок-функция, в продакшене подключите реальный сервис)
async function sendEmail(to, subject, html) {
  log(`📧 Мок-отправка email на ${to}`);
  log(`📨 Тема: ${subject}`);
  log(`📝 Тело: ${html.substring(0, 100)}...`);

  // В реальном приложении здесь должен быть код отправки email
  // Например, через Nodemailer, SendGrid, Mailgun и т.д.

  // Для демо просто логируем
  return true;
}

// Отправка email с подтверждением
async function sendVerificationEmail(email, token) {
  const verificationUrl = `${process.env.APP_URL || 'http://localhost:3000'}/verify-email?token=${token}`;

  const html = `
    <h1>Подтвердите ваш email</h1>
    <p>Для завершения регистрации нажмите на ссылку ниже:</p>
    <a href="${verificationUrl}">Подтвердить email</a>
    <p>Или скопируйте эту ссылку в браузер:</p>
    <p>${verificationUrl}</p>
    <p>Ссылка действительна в течение 24 часов.</p>
  `;

  return await sendEmail(email, 'Подтверждение email - Food Delivery', html);
}

// Отправка email для сброса пароля
async function sendPasswordResetEmail(email, token) {
  const resetUrl = `${process.env.APP_URL || 'http://localhost:3000'}/reset-password?token=${token}`;

  const html = `
    <h1>Сброс пароля</h1>
    <p>Вы запросили сброс пароля. Для установки нового пароля нажмите на ссылку ниже:</p>
    <a href="${resetUrl}">Сбросить пароль</a>
    <p>Или скопируйте эту ссылку в браузер:</p>
    <p>${resetUrl}</p>
    <p>Ссылка действительна в течение 1 часа.</p>
    <p>Если вы не запрашивали сброс пароля, проигнорируйте это письмо.</p>
  `;

  return await sendEmail(email, 'Сброс пароля - Food Delivery', html);
}

// Проверка аутентификации (middleware)
function authenticate(req, res, next) {
  const userId = getUserIdFromToken(req);

  if (!userId) {
    return res.status(401).json({
      success: false,
      error: 'Требуется авторизация'
    });
  }

  req.userId = userId;
  next();
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
      verifyEmail: '/verify-email (GET)',
      resendVerification: '/resend-verification (POST)',
      forgotPassword: '/forgot-password (POST)',
      resetPassword: '/reset-password (POST)',
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

    // Проверка email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        error: 'Некорректный email'
      });
    }

    // Проверка пароля
    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'Пароль должен содержать минимум 6 символов'
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

        // Хешируем пароль
        const hashedPassword = await hashPassword(password);

        // Генерируем токен для подтверждения email
        const verificationToken = generateRandomToken();
        const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 часа

        // Создаем нового пользователя
        const newUser = await pool.query(
            `INSERT INTO users (name, email, password, phone, email_verification_token, email_verification_expires)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id, name, email, phone, avatar_url, is_email_verified, created_at`,
            [name, email, hashedPassword, phone || null, verificationToken, verificationExpires]
        );

        const user = newUser.rows[0];

        // Отправляем email с подтверждением
        await sendVerificationEmail(email, verificationToken);

        // Генерируем JWT токен
        const token = generateToken(user.id);

        res.json({
          success: true,
          message: 'Регистрация успешна. Проверьте ваш email для подтверждения.',
          access_token: token,
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            phone: user.phone,
            avatarUrl: user.avatar_url,
            isEmailVerified: user.is_email_verified,
            createdAt: user.created_at
          }
        });

      } catch (dbError) {
        log(`❌ Ошибка базы при регистрации: ${dbError.message}`);
        return res.status(500).json({
          success: false,
          error: 'Ошибка сервера'
        });
      }
    } else {
      // Мок-режим
      const token = generateToken(Date.now());

      res.json({
        success: true,
        message: 'Регистрация успешна (тестовый режим)',
        access_token: token,
        user: {
          id: Date.now(),
          name,
          email,
          phone: phone || null,
          avatarUrl: null,
          isEmailVerified: false,
          createdAt: new Date().toISOString()
        }
      });
    }

  } catch (error) {
    log(`❌ Ошибка регистрации: ${error.message}`);
    res.status(500).json({
      success: false,
      error: 'Ошибка сервера'
    });
  }
});

// Подтверждение email
app.get('/verify-email', async (req, res) => {
  try {
    const { token } = req.query;

    if (!token) {
      return res.status(400).json({
        success: false,
        error: 'Токен подтверждения отсутствует'
      });
    }

    log(`🔍 Подтверждение email по токену: ${token}`);

    if (isDatabaseConnected && pool) {
      // Находим пользователя по токену
      const userResult = await pool.query(
          `SELECT id, email_verification_expires 
         FROM users 
         WHERE email_verification_token = $1 AND is_email_verified = false`,
          [token]
      );

      if (userResult.rows.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Неверный или устаревший токен подтверждения'
        });
      }

      const user = userResult.rows[0];

      // Проверяем срок действия токена
      if (user.email_verification_expires < new Date()) {
        return res.status(400).json({
          success: false,
          error: 'Срок действия токена истек'
        });
      }

      // Обновляем статус подтверждения
      await pool.query(
          `UPDATE users 
         SET is_email_verified = true, 
             email_verification_token = NULL,
             email_verification_expires = NULL
         WHERE id = $1`,
          [user.id]
      );

      log(`✅ Email подтвержден для пользователя ${user.id}`);

      // Перенаправляем на страницу успеха
      res.json({
        success: true,
        message: 'Email успешно подтвержден!'
      });

    } else {
      // Мок-режим
      res.json({
        success: true,
        message: 'Email подтвержден (тестовый режим)'
      });
    }

  } catch (error) {
    log(`❌ Ошибка подтверждения email: ${error.message}`);
    res.status(500).json({
      success: false,
      error: 'Ошибка сервера'
    });
  }
});

// Повторная отправка письма с подтверждением
app.post('/resend-verification', authenticate, async (req, res) => {
  try {
    const userId = req.userId;

    if (isDatabaseConnected && pool) {
      // Получаем пользователя
      const userResult = await pool.query(
          `SELECT id, email, is_email_verified 
         FROM users 
         WHERE id = $1`,
          [userId]
      );

      if (userResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Пользователь не найден'
        });
      }

      const user = userResult.rows[0];

      if (user.is_email_verified) {
        return res.status(400).json({
          success: false,
          error: 'Email уже подтвержден'
        });
      }

      // Генерируем новый токен
      const verificationToken = generateRandomToken();
      const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

      // Обновляем токен в базе
      await pool.query(
          `UPDATE users 
         SET email_verification_token = $1, 
             email_verification_expires = $2
         WHERE id = $3`,
          [verificationToken, verificationExpires, userId]
      );

      // Отправляем email
      await sendVerificationEmail(user.email, verificationToken);

      res.json({
        success: true,
        message: 'Письмо с подтверждением отправлено повторно'
      });

    } else {
      // Мок-режим
      res.json({
        success: true,
        message: 'Письмо с подтверждением отправлено (тестовый режим)'
      });
    }

  } catch (error) {
    log(`❌ Ошибка повторной отправки подтверждения: ${error.message}`);
    res.status(500).json({
      success: false,
      error: 'Ошибка сервера'
    });
  }
});

// Запрос на сброс пароля
app.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Введите email'
      });
    }

    log(`🔑 Запрос сброса пароля для: ${email}`);

    if (isDatabaseConnected && pool) {
      // Проверяем существование пользователя
      const userResult = await pool.query(
          'SELECT id, email FROM users WHERE email = $1',
          [email]
      );

      if (userResult.rows.length === 0) {
        // Для безопасности не раскрываем, что пользователя нет
        log(`⚠️ Пользователь с email ${email} не найден, но отправляем успешный ответ`);
        return res.json({
          success: true,
          message: 'Если пользователь с таким email существует, инструкции отправлены'
        });
      }

      const user = userResult.rows[0];

      // Генерируем токен для сброса пароля
      const resetToken = generateRandomToken();
      const resetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 час

      // Сохраняем токен в базе
      await pool.query(
          `UPDATE users 
         SET password_reset_token = $1, 
             password_reset_expires = $2
         WHERE id = $3`,
          [resetToken, resetExpires, user.id]
      );

      // Отправляем email
      await sendPasswordResetEmail(email, resetToken);

      res.json({
        success: true,
        message: 'Инструкции по сбросу пароля отправлены на email'
      });

    } else {
      // Мок-режим
      res.json({
        success: true,
        message: 'Инструкции по сбросу пароля отправлены (тестовый режим)'
      });
    }

  } catch (error) {
    log(`❌ Ошибка запроса сброса пароля: ${error.message}`);
    res.status(500).json({
      success: false,
      error: 'Ошибка сервера'
    });
  }
});

// Сброс пароля
app.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({
        success: false,
        error: 'Токен и новый пароль обязательны'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'Пароль должен содержать минимум 6 символов'
      });
    }

    log(`🔑 Сброс пароля по токену: ${token}`);

    if (isDatabaseConnected && pool) {
      // Находим пользователя по токену
      const userResult = await pool.query(
          `SELECT id, password_reset_expires 
         FROM users 
         WHERE password_reset_token = $1`,
          [token]
      );

      if (userResult.rows.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Неверный или устаревший токен сброса пароля'
        });
      }

      const user = userResult.rows[0];

      // Проверяем срок действия токена
      if (user.password_reset_expires < new Date()) {
        return res.status(400).json({
          success: false,
          error: 'Срок действия токена истек'
        });
      }

      // Хешируем новый пароль
      const hashedPassword = await hashPassword(password);

      // Обновляем пароль и очищаем токен
      await pool.query(
          `UPDATE users 
         SET password = $1, 
             password_reset_token = NULL,
             password_reset_expires = NULL
         WHERE id = $2`,
          [hashedPassword, user.id]
      );

      log(`✅ Пароль обновлен для пользователя ${user.id}`);

      res.json({
        success: true,
        message: 'Пароль успешно изменен'
      });

    } else {
      // Мок-режим
      res.json({
        success: false,
        error: 'Сброс пароля не доступен в тестовом режиме'
      });
    }

  } catch (error) {
    log(`❌ Ошибка сброса пароля: ${error.message}`);
    res.status(500).json({
      success: false,
      error: 'Ошибка сервера'
    });
  }
});

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
            'SELECT * FROM users WHERE email = $1',
            [email]
        );

        if (userResult.rows.length === 0) {
          return res.status(401).json({
            success: false,
            error: 'Неверный email или пароль'
          });
        }

        const user = userResult.rows[0];

        // Проверяем пароль
        const isPasswordValid = await comparePassword(password, user.password);

        if (!isPasswordValid) {
          return res.status(401).json({
            success: false,
            error: 'Неверный email или пароль'
          });
        }

        // Проверяем подтверждение email (опционально)
        if (!user.is_email_verified && process.env.REQUIRE_EMAIL_VERIFICATION === 'true') {
          return res.status(403).json({
            success: false,
            error: 'Подтвердите ваш email перед входом',
            requiresVerification: true
          });
        }

        // Генерируем JWT токен
        const token = generateToken(user.id);

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
            isEmailVerified: user.is_email_verified,
            createdAt: user.created_at
          }
        });

      } catch (dbError) {
        log(`❌ Ошибка базы при входе: ${dbError.message}`);
        return res.status(500).json({
          success: false,
          error: 'Ошибка сервера'
        });
      }
    } else {
      // Мок-режим
      const token = generateToken(1);

      res.json({
        success: true,
        message: 'Вход выполнен успешно (тестовый режим)',
        access_token: token,
        user: {
          id: 1,
          name: 'Иван Иванов',
          email: email,
          phone: '+7 (999) 123-45-67',
          avatarUrl: null,
          isEmailVerified: true,
          createdAt: new Date().toISOString()
        }
      });
    }

  } catch (error) {
    log(`❌ Ошибка входа: ${error.message}`);
    res.status(500).json({
      success: false,
      error: 'Ошибка сервера'
    });
  }
});

// Изменение пароля (авторизованный пользователь)
app.post('/change-password', authenticate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.userId;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        error: 'Текущий и новый пароль обязательны'
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'Новый пароль должен содержать минимум 6 символов'
      });
    }

    if (isDatabaseConnected && pool) {
      // Получаем текущий пароль пользователя
      const userResult = await pool.query(
          'SELECT password FROM users WHERE id = $1',
          [userId]
      );

      if (userResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Пользователь не найден'
        });
      }

      const user = userResult.rows[0];

      // Проверяем текущий пароль
      const isPasswordValid = await comparePassword(currentPassword, user.password);

      if (!isPasswordValid) {
        return res.status(401).json({
          success: false,
          error: 'Неверный текущий пароль'
        });
      }

      // Хешируем новый пароль
      const hashedPassword = await hashPassword(newPassword);

      // Обновляем пароль
      await pool.query(
          'UPDATE users SET password = $1 WHERE id = $2',
          [hashedPassword, userId]
      );

      res.json({
        success: true,
        message: 'Пароль успешно изменен'
      });

    } else {
      res.status(400).json({
        success: false,
        error: 'Изменение пароля не доступно в тестовом режиме'
      });
    }

  } catch (error) {
    log(`❌ Ошибка изменения пароля: ${error.message}`);
    res.status(500).json({
      success: false,
      error: 'Ошибка сервера'
    });
  }
});

// Получение данных текущего пользователя
app.get('/users/me', authenticate, async (req, res) => {
  try {
    const userId = req.userId;

    // Если база подключена, получаем данные из БД
    if (isDatabaseConnected && pool) {
      try {
        const userResult = await pool.query(
            'SELECT id, name, email, phone, avatar_url, is_email_verified, created_at FROM users WHERE id = $1',
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
          isEmailVerified: user.is_email_verified,
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
        isEmailVerified: true,
        createdAt: new Date().toISOString()
      });
    }

  } catch (error) {
    log(`❌ Ошибка получения пользователя: ${error.message}`);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Статистика заказов
app.get('/users/me/stats', authenticate, async (req, res) => {
  try {
    const userId = req.userId;

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
app.get('/users/me/orders', authenticate, async (req, res) => {
  try {
    const userId = req.userId;

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
      log(`🔐 JWT используется: ${process.env.JWT_SECRET ? 'Да' : 'Нет (используется дефолтный)'}`);

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