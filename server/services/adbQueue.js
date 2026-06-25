/**
 * HĂ ng Ä‘á»£i tuáº§n tá»± cho lá»‡nh ADB â€” trĂ¡nh block event loop khi push/pull nhiá»u mĂ¡y.
 */
function createAdbQueue() {
    const queue = [];
    let running = false;

    async function pump() {
        if (running) return;
        running = true;
        while (queue.length) {
            const job = queue.shift();
            try {
                job.resolve(await job.fn());
            } catch (e) {
                job.reject(e);
            }
        }
        running = false;
    }

    function enqueue(fn) {
        return new Promise((resolve, reject) => {
            queue.push({ fn, resolve, reject });
            pump();
        });
    }

    return { enqueue };
}

module.exports = { createAdbQueue };
