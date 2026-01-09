-- Таблица пользователей
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    phone VARCHAR(20),
    avatar_url TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Таблица ресторанов
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
);

-- Таблица блюд
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
);

-- Таблица заказов
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
);

-- Таблица элементов заказа
CREATE TABLE IF NOT EXISTS order_items (
    id SERIAL PRIMARY KEY,
    order_id INTEGER REFERENCES orders(id),
    dish_id INTEGER REFERENCES dishes(id),
    dish_name VARCHAR(100),
    dish_price DECIMAL(10,2),
    quantity INTEGER DEFAULT 1
);

-- Тестовые данные
INSERT INTO users (name, email, password, phone) VALUES
('Иван Иванов', 'ivan@example.com', 'password123', '+7 (999) 123-45-67')
ON CONFLICT (email) DO NOTHING;

INSERT INTO restaurants (name, description, image_url, rating, delivery_time, delivery_price, categories) VALUES
('Пицца Мания', 'Итальянская кухня, пицца, паста', 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=400', 4.7, '25-35 мин', 'Бесплатно', ARRAY['Пицца', 'Итальянская', 'Паста']),
('Бургер Кинг', 'Бургеры, картофель фри, напитки', 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=400', 4.5, '20-30 мин', '99 ₽', ARRAY['Бургеры', 'Фастфуд'])
ON CONFLICT DO NOTHING;

INSERT INTO dishes (restaurant_id, name, description, image_url, price, ingredients, preparation_time, is_vegetarian, is_spicy) VALUES
(1, 'Пепперони', 'Пицца с колбасками пепперони и сыром моцарелла', 'https://images.unsplash.com/photo-1628840042765-356cda07504e?w=400', 699.00, ARRAY['Тесто', 'Томатный соус', 'Пепперони', 'Моцарелла'], 25, false, false),
(1, 'Маргарита', 'Классическая пицца с томатами и базиликом', 'https://images.unsplash.com/photo-1604068549290-dea0e4a305ca?w=400', 599.00, ARRAY['Тесто', 'Томатный соус', 'Моцарелла', 'Томаты', 'Базилик'], 20, true, false),
(2, 'Чизбургер', 'Классический бургер с сыром', 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=400', 299.00, ARRAY['Булочка', 'Говяжья котлета', 'Сыр', 'Лук', 'Кетчуп'], 15, false, false)
ON CONFLICT DO NOTHING;

-- Индексы для ускорения запросов
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_dishes_restaurant_id ON dishes(restaurant_id);