/**
 * /public/games/who-is-it/game.js
 * Phaser 3 – Background animation for the "Who Is It?" game.
 *
 * This module exports `WhoIsItGame`, which manages the Phaser instance
 * that runs behind the HTML overlay panels. It provides:
 *  - AnimatedBGScene : floating shapes / particles backdrop
 *  - The ability to trigger celebratory animations from main.js
 */

import { AnimatedBGScene } from './ui.js';

export const WhoIsItGame = {
  /**
   * Mount a Phaser background canvas into the given container.
   * @param {string} containerId - ID of the DOM element to attach to.
   * @returns Phaser.Game instance
   */
  createBackground(containerId) {
    const config = {
      type: Phaser.AUTO,
      parent: containerId,
      backgroundColor: '#0b0d14',
      scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: '100%',
        height: '100%',
      },
      transparent: false,
      scene: [AnimatedBGScene],
      // Disable input so Phaser doesn't swallow HTML events
      input: { mouse: false, touch: false, keyboard: false },
    };

    return new Phaser.Game(config);
  },
};
