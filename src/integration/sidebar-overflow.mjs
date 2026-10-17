import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {prototypeFixture} from '../test/prototype-fixture.mjs';
const f = await prototypeFixture();
const browser = await chromium.launch({headless:true,args:['--no-sandbox']});
try {
  const page = await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});
  await page.goto(f.base);
  await page.locator('#token').fill('fixture');
  await page.locator('#login-form').evaluate(form => form.requestSubmit());
  await page.locator('#login').waitFor({state:'hidden'});
  await page.locator('.chatlink').first().waitFor();
  for (const width of [1440,390]) {
    await page.setViewportSize({width,height:900});
    await page.evaluate(() => document.querySelector('.sidebar').classList.add('open'));
    const sizes = await page.locator('.side-scroll').evaluate(el => {
      el.querySelectorAll('.name').forEach(n => n.textContent = 'LongChatTitle'.repeat(50));
      return {client:el.clientWidth,scroll:el.scrollWidth,overflow:getComputedStyle(el).overflowX};
    });
    assert.equal(sizes.overflow, 'hidden', JSON.stringify({width,...sizes}));
    assert.ok(sizes.scroll <= sizes.client + 1, JSON.stringify({width,...sizes}));
  }
  console.log('Sidebar has no horizontal overflow at desktop and mobile widths with long chat titles.');
} finally {await browser.close();await f.close();}
