/**
 * AEGIS Event Bus — typed EventEmitter hub.
 * All signals flow through here. Monitors emit, strategies subscribe.
 * Decouples signal sources from signal consumers completely.
 */

import { EventEmitter } from 'node:events';
import { SignalType } from './types.mjs';

class AegisEventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50); // strategies + monitors + bot listeners
    this._stats = {};
    for (const type of Object.values(SignalType)) {
      this._stats[type] = 0;
    }
  }

  /**
   * Emit a typed signal. Only known signal types are allowed.
   * @param {string} type - One of SignalType values
   * @param {object} data - Signal payload
   */
  signal(type, data) {
    if (!SignalType[type]) {
      throw new Error(`Unknown signal type: ${type}. Must be one of: ${Object.keys(SignalType).join(', ')}`);
    }
    this._stats[type] = (this._stats[type] || 0) + 1;
    this.emit(type, { type, timestamp: new Date().toISOString(), ...data });
  }

  /**
   * Subscribe to a signal type.
   * @param {string} type - One of SignalType values
   * @param {Function} handler - Signal handler
   * @returns {Function} Unsubscribe function
   */
  subscribe(type, handler) {
    this.on(type, handler);
    return () => this.off(type, handler);
  }

  /**
   * Get emission stats for all signal types.
   */
  getStats() {
    return { ...this._stats };
  }

  /**
   * Reset all stats.
   */
  resetStats() {
    for (const type of Object.keys(this._stats)) {
      this._stats[type] = 0;
    }
  }
}

// Singleton — one bus per process
const bus = new AegisEventBus();
export default bus;
