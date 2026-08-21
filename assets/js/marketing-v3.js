(()=>{
  'use strict';

  const hero=document.querySelector('.hero#overview');
  if(!hero)return;

  document.body.classList.add('ff-marketing-v3');
  hero.classList.add('ff-hero-v3');

  document.querySelectorAll('.brand .tagline').forEach(node=>{
    node.textContent='CARD INTELLIGENCE';
  });
})();
