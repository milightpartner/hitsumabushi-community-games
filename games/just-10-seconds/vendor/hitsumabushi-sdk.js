/**
 * OmoshiroGamePortal - Official Game Integration SDK (v1.0.0)
 *
 * Provides communication between Individual Game Apps (iframe) and Portal Host.
 * Supports postMessage signaling, transparent WebSocket data relaying,
 * and Future Steamworks Platform Adapter abstraction.
 *
 * External API reference (authoritative): packages/hitsumabushi-sdk/docs/api-reference.md
 * Internal design reference: docs/design/hitsumabushi-sdk.md
 */

class HitsumabushiSDK {
  constructor() {
    this.isInitialized = false;
    this.callbacks = {};
    this.gameSocket = null;
    this.config = null;
    this.parentOrigin = typeof window !== 'undefined' && document.referrer 
      ? new URL(document.referrer, window.location.origin).origin 
      : '*';

    // Listen for postMessage events from Portal Host
    if (typeof window !== 'undefined') {
      window.addEventListener('message', this.handleHostMessage.bind(this));
    }
  }

  /**
   * Initialize SDK and notify Portal Host that Game is ready to receive configuration.
   * @param {Object} options - Callback handlers for Portal events.
   * @param {Function} [options.onInitGame] - Called when Portal injects room/player config.
   * @param {Function} [options.onObsModeChange] - Called when OBS transparent mode toggles.
   * @param {Function} [options.onStreamerModeChange] - Called when Streamer mode toggles.
   * @param {Function} [options.onGameData] - Called when a real-time data packet arrives from opponent.
   */
  init(options = {}) {
    this.callbacks = {
      onInitGame: options.onInitGame || (() => {}),
      onObsModeChange: options.onObsModeChange || (() => {}),
      onStreamerModeChange: options.onStreamerModeChange || (() => {}),
      onGameData: options.onGameData || (() => {})
    };

    this.isInitialized = true;

    // Send GAME_READY to Parent Window
    this.postToHost({
      type: 'GAME_READY',
      version: '1.0.0'
    });
  }

  /**
   * Handle incoming messages from Parent Window (Portal Host)
   */
  handleHostMessage(event) {
    if (event.origin && event.origin !== 'null') {
      this.parentOrigin = event.origin;
    }

    const data = event.data;
    if (!data || !data.type) return;

    switch (data.type) {
      case 'INIT_GAME':
        if (data.portalOrigin) {
          this.parentOrigin = data.portalOrigin;
        }
        this.config = data;
        if (typeof this.callbacks.onInitGame === 'function') {
          this.callbacks.onInitGame(data);
        }
        break;

      case 'SET_OBS_MODE':
        if (this.callbacks.onObsModeChange) {
          this.callbacks.onObsModeChange(data.isObsMode);
        }
        break;

      case 'SET_STREAMER_MODE':
        if (this.callbacks.onStreamerModeChange) {
          this.callbacks.onStreamerModeChange(data.isStreamerMode);
        }
        break;

      case 'GAME_DATA_RELAY':
        // Transparent WebSocket/postMessage relay from opponent.
        // senderId is already resolved to a logical player ID ('p1' | 'p2') by GameViewer.
        if (this.callbacks.onGameData) {
          this.callbacks.onGameData(data.payload, data.senderId ?? null);
        }
        break;
    }
  }

  /**
   * Send real-time game data payload to opponent (Transparent Pass-through Relay).
   * @param {*} payload - Arbitrary JSON-serializable game data.
   */
  sendGameData(payload) {
    if (this.isSpectator()) {
      console.warn('[Hitsumabushi SDK] Blocked sendGameData: Spectators cannot send in-game action packets.');
      return;
    }
    this.postToHost({
      type: 'GAME_DATA_RELAY',
      payload: payload
    });
  }

  /**
   * Subscribe to incoming game data from opponent.
   * Can also be set via init({ onGameData }) — this method allows late/dynamic binding.
   * @param {Function} callback - (payload, senderId) => void
   */
  onGameData(callback) {
    this.callbacks.onGameData = callback;
  }

  /**
   * Send Score Update (for OBS Overlay Scoreboard & Portal Spectators).
   * @param {Object} scores - e.g. { p1: 2, p2: 0 }
   * @param {number} [currentRound=1]
   */
  sendScoreUpdate(scores, currentRound = 1) {
    if (this.isSpectator()) {
      console.warn('[Hitsumabushi SDK] Blocked sendScoreUpdate: Spectators cannot send score updates.');
      return;
    }
    this.postToHost({
      type: 'SCORE_UPDATE',
      scores: scores,
      currentRound: currentRound
    });
  }

  /**
   * Send Match Conclusion (Triggers victory confetti, tournament bracket progression).
   * @param {Object} data
   * @param {string} [data.winnerPlayerId] - Winner's player ID ('p1' | 'p2'). Omit when isTie=true.
   * @param {string[]} [data.rankings]     - Ordered rankings array e.g. ['p1', 'p2']. Optional.
   * @param {boolean} [data.isTie=false]   - Set true for a draw/tie result.
   * @param {Object}  [data.scores={}]     - Final scores per player.
   * @param {Object}  [data.stats={}]      - Match statistics (duration, etc.).
   */
  sendGameOver(data) {
    if (this.isSpectator()) {
      console.warn('[Hitsumabushi SDK] Blocked sendGameOver: Spectators cannot send match finish results.');
      return;
    }
    this.postToHost({
      type: 'GAME_OVER',
      winnerPlayerId: data.winnerPlayerId ?? null,
      rankings: data.rankings ?? [],
      isTie: data.isTie ?? false,
      scores: data.scores ?? {},
      stats: data.stats ?? {}
    });
  }

  /**
   * Request Achievement Unlock (Supports Web & Future Steam Achievements).
   * @param {string} achievementId
   */
  unlockAchievement(achievementId) {
    if (this.isSpectator()) {
      console.warn('[Hitsumabushi SDK] Blocked unlockAchievement: Spectators cannot unlock match achievements.');
      return;
    }
    this.postToHost({
      type: 'UNLOCK_ACHIEVEMENT',
      achievementId: achievementId
    });
  }

  /**
   * Returns true if the local player is the Room Host / Owner (created the room).
   * Can be either a Spectator or a seated Player.
   * Always returns false before onInitGame has fired.
   * @returns {boolean}
   */
  isRoomHost() {
    if (!this.config) return false;
    return !!this.config.isHost;
  }

  /**
   * Returns true if the local client is the match authority (seated player in first active slot, e.g. 'p1').
   * Spectators never qualify as Game Master even if they are Room Host.
   * Guard one-time match authority tasks (timer progression, bot computation, turn advances) with this.
   * @returns {boolean}
   */
  isGameMaster() {
    if (!this.config || this.isSpectator()) return false;
    const firstPlayer = this.config.players?.[0];
    return !!(firstPlayer && this.config.localPlayerId === firstPlayer.id);
  }

  /**
   * Backward-compatible alias for isGameMaster().
   * Returns true if the local player is seated in slot 0 ('p1') and not spectating.
   * To check if the local client created the room, use isRoomHost().
   * @returns {boolean}
   */
  isHost() {
    return this.isGameMaster();
  }

  /**
   * Returns true if the local client joined as a Spectator (not a playing slot).
   * Always returns false before onInitGame has fired.
   * @returns {boolean}
   */
  isSpectator() {
    if (!this.config) return false;
    return !!this.config.isSpectator || !this.config.localPlayerId;
  }

  /**
   * Returns the full config object injected by INIT_GAME, or null before init.
   * Useful for debugging or accessing fields like teamId from config.players.
   * @returns {Object|null}
   */
  getConfig() {
    return this.config;
  }

  /**
   * Helper: Send message to parent iframe host
   */
  postToHost(message) {
    if (window.parent && window.parent !== window) {
      const targetOrigin = this.parentOrigin || '*';
      window.parent.postMessage(message, targetOrigin);
    }
  }
}

// Export Singleton Instance
export const Hitsumabushi = new HitsumabushiSDK();
if (typeof window !== 'undefined') {
  window.Hitsumabushi = Hitsumabushi;
}
