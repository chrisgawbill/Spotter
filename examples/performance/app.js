/* bundle seed */
// Stands in for the app's existing code, so a small seeded change stays under the build.js budget.
const existing = 'UnuAuQTH1Yjuxe8fHo/uBcDaTu4/vhowuBDC9faS4hC7f+m+txDG4WsPdUD3bXUdKsJe6clkb5VPZS/RdqVBkGdIi0uszUgNKlFgaFR3z5cpp/c78H9Gc+n6biO2bl1Nhgof78oJd2d5xoEOer4wKY2LZ2niUzcZUK1TY/fQQ7Q+doGGDqWiJ8FprDYg8siJVqPHvfE8LdIxv+S1rGKH8oDR+KLLlWjAbD3UugTGAynfuecCx78RHblBIpBbqwiXBT9p73DLtVvPth10zwkxZyh3HPt6qAzORyc3lGEllaJtN1YHyZGtWAJYAwNIxamkN0cDeLFQLY4XqKbMqUcs7rwjRP53PmC3CTS+qZuryJJiE+e4UGsCqCfNeH53MW8MyubViA5PaGBxHNqEIsOArHTDJJmVYYbVnCJ8EbTicGOBos4DLfYoE/EQDY/EX6ECaJ//C80indmeQE8gJHAeiZjQZ2FkQevuEMRgnq+RxdMJdIZPoN2GFHrKjjLp9LNMzlVohHljGemNM46ynKdSa/0vRrodedLTpEZm+w1oShogVMPINWN6qms1ArVQ2YbYM6Vtp4VsW+wing1yf5+tkEqKc8V0rVR/G26eSajNP9LiKhbBBPOmbtWHBx4C8atWE10c+kmoNNZldbxoP2h7HCkVWPWeYRK41U86tIjW7l9QTNKx2gzVedspU0u4C4ddeeoJHczk0D3MyLSDFCtqzFhuhvaGXZuMm5hz4XtCpznhogYaCeXCVmYD9/dwxB4CMA5YZrDQPzxEXEXcdBwOGcxrTwDmAqbpcEwAdCx+4+0vh4kesTAIIDu9acCRYrVQ3lR60v/V4SJ/QPjkXXXo08jM+mxYTnX0xzbOXSSKQV0y7fkvRrLQSg6pt2vz+elv5+vvRhQukyDRSwZVRWENHZDYHPAJ1TI0Cy3OaYlnHoMgmtYtXnBA6tij+6oRZ7Ul9fZuwdn4r2BngFQheGMlxNKeYmoJ5ds8XmP6DLQP';
const list = document.getElementById('list');
document.documentElement.dataset.size = existing.length;
const details = document.getElementById('details');

async function load() {
  const { items } = await (await fetch('api/items')).json();
  list.replaceChildren(...items.map((item) => Object.assign(document.createElement('li'), { textContent: item.name })));
}

document.getElementById('open').onclick = () => {
  details.hidden = false;
};

load();
