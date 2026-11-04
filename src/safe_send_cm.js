/**
 * Parent IPC `send_cm` must not crash CharacterThread when the AL socket is
 * already torn down (DNS drop / softkill race). Live: uncaught
 * `socket.emit` TypeError killed the child during Hard-terminate.
 *
 * Mirrors adventure.land `send_code_message` payload shape.
 */

/**
 * @param {any} socket
 * @param {string|string[]} to
 * @param {unknown} data
 * @returns {boolean} true if emit was attempted successfully
 */
function safeSendCodeMessage(socket, to, data) {
  if (!socket || typeof socket.emit !== "function") {
    return false;
  }
  try {
    socket.emit("cm", { to, message: JSON.stringify(data) });
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = { safeSendCodeMessage };
