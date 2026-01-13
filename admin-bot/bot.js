const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
require('dotenv').config();

// Конфигурация
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_API_KEY = process.env.ADMIN_API_KEY;
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8000/api';

// Инициализация бота
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// Состояния для FSM (Finite State Machine)
const userStates = {};

// Функция для вызова API
async function callAdminAPI(endpoint, method = 'GET', data = null) {
    try {
        const config = {
            method,
            url: `${API_BASE_URL}${endpoint}`,
            headers: {
                'X-Admin-API-Key': ADMIN_API_KEY,
                'Content-Type': 'application/json'
            }
        };

        if (data) {
            config.data = data;
        }

        const response = await axios(config);
        return response.data;
    } catch (error) {
        console.error('API Error:', error.response?.data || error.message);
        throw error;
    }
}

// Команды бота
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId,
        `👨‍🍳 Привет, администратор!\n\n` +
        `Доступные команды:\n` +
        `/menu - Управление меню\n` +
        `/restaurants - Управление ресторанами\n` +
        `/stats - Статистика\n` +
        `/help - Помощь`
    );
});

bot.onText(/\/menu/, async (msg) => {
    const chatId = msg.chat.id;

    try {
        const restaurants = await callAdminAPI('/admin/restaurants');

        if (restaurants.length === 0) {
            return bot.sendMessage(chatId, 'Рестораны не найдены');
        }

        const keyboard = restaurants.map(rest => [{
            text: `🍽️ ${rest.name}`,
            callback_data: `restaurant_${rest.id}`
        }]);

        bot.sendMessage(chatId, 'Выберите ресторан для управления меню:', {
            reply_markup: {
                inline_keyboard: keyboard
            }
        });
    } catch (error) {
        bot.sendMessage(chatId, 'Ошибка получения ресторанов');
    }
});

// Обработка колбэков
bot.on('callback_query', async (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const data = callbackQuery.data;

    if (data.startsWith('restaurant_')) {
        const restaurantId = data.split('_')[1];

        try {
            const dishes = await callAdminAPI(`/admin/restaurants/${restaurantId}/dishes`);

            if (dishes.length === 0) {
                return bot.sendMessage(chatId, 'В этом ресторане пока нет блюд');
            }

            // Создаем клавиатуру с блюдами
            const dishButtons = dishes.map(dish => [{
                text: `${dish.is_available ? '✅' : '❌'} ${dish.name} - ${dish.price} ₽`,
                callback_data: `dish_${dish.id}`
            }]);

            dishButtons.push([{ text: '➕ Добавить блюдо', callback_data: `add_dish_${restaurantId}` }]);
            dishButtons.push([{ text: '🔙 Назад', callback_data: 'back_to_restaurants' }]);

            bot.sendMessage(chatId, 'Управление блюдами:', {
                reply_markup: { inline_keyboard: dishButtons }
            });
        } catch (error) {
            bot.sendMessage(chatId, 'Ошибка получения меню');
        }
    }

    if (data.startsWith('dish_')) {
        const dishId = data.split('_')[1];
        userStates[chatId] = { dishId, action: 'edit_dish' };

        const keyboard = [
            [{ text: '🔄 Изменить доступность', callback_data: `toggle_dish_${dishId}` }],
            [{ text: '✏️ Редактировать', callback_data: `edit_dish_${dishId}` }],
            [{ text: '🗑️ Удалить', callback_data: `delete_dish_${dishId}` }],
            [{ text: '🔙 Назад', callback_data: 'back_to_menu' }]
        ];

        bot.sendMessage(chatId, 'Что сделать с блюдом?', {
            reply_markup: { inline_keyboard: keyboard }
        });
    }

    if (data.startsWith('toggle_dish_')) {
        const dishId = data.split('_')[2];

        try {
            const result = await callAdminAPI(`/bot/dish/${dishId}/toggle`, 'POST');
            bot.sendMessage(chatId, result.message);
        } catch (error) {
            bot.sendMessage(chatId, 'Ошибка обновления блюда');
        }
    }

    if (data.startsWith('add_dish_')) {
        const restaurantId = data.split('_')[2];
        userStates[chatId] = { restaurantId, action: 'add_dish' };

        bot.sendMessage(chatId,
            'Введите данные блюда в формате:\n\n' +
            'Название\n' +
            'Описание\n' +
            'Цена\n' +
            'Время приготовления (мин)\n' +
            'Пример:\n' +
            'Маргарита\n' +
            'Классическая пицца\n' +
            '599\n' +
            '20'
        );
    }

    if (data === 'back_to_restaurants') {
        bot.sendMessage(chatId, 'Используйте /menu для выбора ресторана');
    }

    if (data === 'back_to_menu') {
        bot.sendMessage(chatId, 'Используйте /menu для управления меню');
    }
});

// Обработка текстовых сообщений для добавления блюд
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (!userStates[chatId]) return;

    const state = userStates[chatId];

    if (state.action === 'add_dish') {
        const lines = text.split('\n');

        if (lines.length < 4) {
            return bot.sendMessage(chatId, 'Неверный формат. Пожалуйста, введите все данные.');
        }

        const [name, description, price, preparationTime] = lines;

        try {
            await callAdminAPI('/admin/dishes', 'POST', {
                restaurant_id: state.restaurantId,
                name: name.trim(),
                description: description.trim(),
                price: parseFloat(price),
                preparation_time: parseInt(preparationTime),
                is_available: true
            });

            bot.sendMessage(chatId, `✅ Блюдо "${name}" успешно добавлено!`);
            delete userStates[chatId];
        } catch (error) {
            bot.sendMessage(chatId, '❌ Ошибка при добавлении блюда');
        }
    }
});

// Команда статистики
bot.onText(/\/stats/, async (msg) => {
    const chatId = msg.chat.id;

    try {
        const stats = await callAdminAPI('/bot/stats');

        const message =
            `📊 Статистика системы:\n\n` +
            `🍽️ Активных ресторанов: ${stats.active_restaurants}\n` +
            `🍕 Доступных блюд: ${stats.available_dishes}\n` +
            `📦 Заказов за 24ч: ${stats.orders_last_24h}\n\n` +
            `🕒 Обновлено: ${new Date().toLocaleTimeString()}`;

        bot.sendMessage(chatId, message);
    } catch (error) {
        bot.sendMessage(chatId, 'Ошибка получения статистики');
    }
});

// Команда помощи
bot.onText(/\/help/, (msg) => {
    const chatId = msg.chat.id;

    const helpText =
        `📖 Руководство администратора:\n\n` +
        `/menu - Управление меню ресторанов\n` +
        `/restaurants - Управление ресторанами\n` +
        `/stats - Просмотр статистики\n\n` +
        `⚡ Быстрые действия:\n` +
        `• Нажмите на блюдо в меню для управления\n` +
        `• Используйте кнопки для переключения доступности\n` +
        `• Добавляйте новые блюда через диалог\n\n` +
        `❓ Проблемы? Обратитесь к разработчику.`;

    bot.sendMessage(chatId, helpText);
});

console.log('🤖 Telegram бот для админа запущен...');