const cron = require('node-cron');
const { config } = require('../config');
const SchedulerState = require('../models/SchedulerState');
const weeklyService = require('./weeklyService');
const { getIsoWeekStartDate, getNextIsoWeekKey } = require('../utils/dateUtils');
const logger = require('../utils/logger');

const WEEKLY_ROTATION_STATE_KEY = 'weekly-role-rotation';

class SchedulerService {
  constructor() {
    this.started = false;
    this.weeklyRoleJob = null;
  }

  async start(client) {
    if (this.started) {
      return;
    }

    try {
      await this.catchUpWeeklyRotation(client);
    } catch (error) {
      logger.error('Weekly rotation catch-up failed', { error: error.message });
    }

    this.weeklyRoleJob = cron.schedule(
      config.scheduler.weeklyCron,
      async () => {
        try {
          await this.runWeeklyRotation(client);
        } catch (error) {
          logger.error('Weekly scheduler job failed', { error: error.message });
        }
      },
      {
        timezone: config.scheduler.timezone
      }
    );

    this.started = true;

    logger.info('Scheduler started', {
      weeklyRoleCron: config.scheduler.weeklyCron,
      timezone: config.scheduler.timezone
    });
  }

  async catchUpWeeklyRotation(client) {
    const targetWeekKey = weeklyService.getPreviousWeekKey();

    const state = await SchedulerState.findOneAndUpdate(
      { key: WEEKLY_ROTATION_STATE_KEY },
      {
        $setOnInsert: {
          key: WEEKLY_ROTATION_STATE_KEY,
          lastProcessedWeekKey: null,
          lastProcessedAt: null
        }
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true
      }
    );

    const pendingWeekKeys = this.getPendingWeeklyRotationWeekKeys(
      state.lastProcessedWeekKey,
      targetWeekKey
    );

    if (pendingWeekKeys.length === 0) {
      logger.info('Weekly rotation catch-up not needed', {
        lastProcessedWeekKey: state.lastProcessedWeekKey,
        targetWeekKey
      });
      return;
    }

    logger.info('Weekly rotation catch-up started', {
      lastProcessedWeekKey: state.lastProcessedWeekKey,
      targetWeekKey,
      pendingWeekKeys
    });

    for (const weekKey of pendingWeekKeys) {
      await this.runWeeklyRotationForWeek(client, weekKey);
    }

    logger.info('Weekly rotation catch-up completed', {
      processedWeekKeys: pendingWeekKeys
    });
  }

  getPendingWeeklyRotationWeekKeys(lastProcessedWeekKey, targetWeekKey) {
    if (!targetWeekKey) {
      return [];
    }

    if (!lastProcessedWeekKey) {
      return [targetWeekKey];
    }

    const targetStartMs = getIsoWeekStartDate(targetWeekKey).getTime();
    const pendingWeekKeys = [];

    for (
      let currentWeekKey = getNextIsoWeekKey(lastProcessedWeekKey);
      getIsoWeekStartDate(currentWeekKey).getTime() <= targetStartMs;
      currentWeekKey = getNextIsoWeekKey(currentWeekKey)
    ) {
      pendingWeekKeys.push(currentWeekKey);

      if (currentWeekKey === targetWeekKey) {
        break;
      }
    }

    return pendingWeekKeys;
  }

  async runWeeklyRotationForWeek(client, weekKey) {
    await weeklyService.processWeeklyRoleRotationForWeek(client, weekKey);

    await SchedulerState.updateOne(
      { key: WEEKLY_ROTATION_STATE_KEY },
      {
        $set: {
          lastProcessedWeekKey: weekKey,
          lastProcessedAt: new Date()
        }
      },
      { upsert: true }
    );
  }

  async runWeeklyRotation(client) {
    return this.runWeeklyRotationForWeek(client, weeklyService.getPreviousWeekKey());
  }
}

module.exports = new SchedulerService();
