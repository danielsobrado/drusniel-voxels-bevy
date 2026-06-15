(function(){const e=document.createElement("link").relList;if(e&&e.supports&&e.supports("modulepreload"))return;for(const r of document.querySelectorAll('link[rel="modulepreload"]'))i(r);new MutationObserver(r=>{for(const s of r)if(s.type==="childList")for(const o of s.addedNodes)o.tagName==="LINK"&&o.rel==="modulepreload"&&i(o)}).observe(document,{childList:!0,subtree:!0});function t(r){const s={};return r.integrity&&(s.integrity=r.integrity),r.referrerPolicy&&(s.referrerPolicy=r.referrerPolicy),r.crossOrigin==="use-credentials"?s.credentials="include":r.crossOrigin==="anonymous"?s.credentials="omit":s.credentials="same-origin",s}function i(r){if(r.ep)return;r.ep=!0;const s=t(r);fetch(r.href,s)}})();const Hm="modulepreload",Vm=function(n){return"/drusniel-voxels-bevy/"+n},Pd={},lo=function(e,t,i){let r=Promise.resolve();if(t&&t.length>0){document.getElementsByTagName("link");const o=document.querySelector("meta[property=csp-nonce]"),a=o?.nonce||o?.getAttribute("nonce");r=Promise.allSettled(t.map(l=>{if(l=Vm(l),l in Pd)return;Pd[l]=!0;const c=l.endsWith(".css"),u=c?'[rel="stylesheet"]':"";if(document.querySelector(`link[href="${l}"]${u}`))return;const d=document.createElement("link");if(d.rel=c?"stylesheet":Hm,c||(d.as="script"),d.crossOrigin="",d.href=l,a&&d.setAttribute("nonce",a),document.head.appendChild(d),c)return new Promise((h,f)=>{d.addEventListener("load",h),d.addEventListener("error",()=>f(new Error(`Unable to preload CSS for ${l}`)))})}))}function s(o){const a=new Event("vite:preloadError",{cancelable:!0});if(a.payload=o,window.dispatchEvent(a),!a.defaultPrevented)throw o}return r.then(o=>{for(const a of o||[])a.status==="rejected"&&s(a.reason);return e().catch(s)})},Gm="/drusniel-voxels-bevy/assets/bedrock-1-DaVJSdJ4.jpg",Wm="/drusniel-voxels-bevy/assets/bedrock-2-UqGZYPf1.jpg",$m="/drusniel-voxels-bevy/assets/cobblestone-1-DNWnIhp3.jpg",Xm="/drusniel-voxels-bevy/assets/cobblestone-2-3iouCABT.jpg",jm="/drusniel-voxels-bevy/assets/earth-1-BptOua-5.jpg",qm="/drusniel-voxels-bevy/assets/earth-2-Ckn-bJdD.jpg",Ym="/drusniel-voxels-bevy/assets/grass-1-BL9NE2hZ.jpg",Zm="/drusniel-voxels-bevy/assets/grass-2-BztVas3P.jpg",Km="/drusniel-voxels-bevy/assets/oak-bark-1-DBHCYBGm.jpg",Jm="/drusniel-voxels-bevy/assets/oak-bark-2-C9QWbGLn.jpg",Qm="/drusniel-voxels-bevy/assets/oak-leaf-1-BGNejCWc.jpg",eg="/drusniel-voxels-bevy/assets/oak-leaf-2-CufSRKg1.jpg",tg="/drusniel-voxels-bevy/assets/sand-1-CHWfM9Rt.jpg",ng="/drusniel-voxels-bevy/assets/sand-2-D_SOEfdJ.jpg",ig="/drusniel-voxels-bevy/assets/snow-1-DGpfleMQ.jpg",rg="/drusniel-voxels-bevy/assets/snow-rocks-1-CaANjb00.jpg",sg="/drusniel-voxels-bevy/assets/terracotta-1-CIWOrXET.jpg",og="/drusniel-voxels-bevy/assets/terracotta-2-CHE-sMY0.jpg",ag="/drusniel-voxels-bevy/assets/water-1-BBnesnRa.jpg",lg="/drusniel-voxels-bevy/assets/water-2-DphCtYu2.jpg";/**
 * @license
 * Copyright 2010-2024 Three.js Authors
 * SPDX-License-Identifier: MIT
 */const po="169",ms={ROTATE:0,DOLLY:1,PAN:2},ds={ROTATE:0,PAN:1,DOLLY_PAN:2,DOLLY_ROTATE:3},cg=0,Rd=1,ug=2,Gf=1,dg=2,bi=3,In=0,un=1,en=2,er=0,gs=1,Ld=2,Id=3,Dd=4,hg=5,xr=100,fg=101,pg=102,mg=103,gg=104,_g=200,vg=201,yg=202,xg=203,pc=204,mc=205,bg=206,Sg=207,Mg=208,wg=209,Eg=210,Tg=211,Ag=212,Cg=213,Pg=214,gc=0,_c=1,vc=2,ys=3,yc=4,xc=5,bc=6,Sc=7,Wf=0,Rg=1,Lg=2,tr=0,Ig=1,Dg=2,Ng=3,$f=4,Ug=5,Fg=6,Og=7,Xf=300,xs=301,bs=302,Mc=303,wc=304,Ga=306,wi=1e3,Sr=1001,Ec=1002,Hn=1003,Bg=1004,Lo=1005,zn=1006,ml=1007,Ki=1008,ci=1009,jf=1010,qf=1011,co=1012,bu=1013,Mr=1014,Ai=1015,mo=1016,Su=1017,Mu=1018,Ss=1020,Yf=35902,Zf=1021,Kf=1022,Vn=1023,Jf=1024,Qf=1025,_s=1026,Ms=1027,ep=1028,wu=1029,tp=1030,Eu=1031,Tu=1033,wa=33776,Ea=33777,Ta=33778,Aa=33779,Tc=35840,Ac=35841,Cc=35842,Pc=35843,Rc=36196,Lc=37492,Ic=37496,Dc=37808,Nc=37809,Uc=37810,Fc=37811,Oc=37812,Bc=37813,kc=37814,zc=37815,Hc=37816,Vc=37817,Gc=37818,Wc=37819,$c=37820,Xc=37821,Ca=36492,jc=36494,qc=36495,np=36283,Yc=36284,Zc=36285,Kc=36286,jE=2300,qE=2301,kg=3200,zg=3201,ip=0,Hg=1,oi="",Ln="srgb",rr="srgb-linear",Au="display-p3",Wa="display-p3-linear",Da="linear",bt="srgb",Na="rec709",Ua="p3",Fr=7680,Nd=519,Vg=512,Gg=513,Wg=514,rp=515,$g=516,Xg=517,jg=518,qg=519,Ud=35044,Fd="300 es",Ci=2e3,Fa=2001;class Er{addEventListener(e,t){this._listeners===void 0&&(this._listeners={});const i=this._listeners;i[e]===void 0&&(i[e]=[]),i[e].indexOf(t)===-1&&i[e].push(t)}hasEventListener(e,t){if(this._listeners===void 0)return!1;const i=this._listeners;return i[e]!==void 0&&i[e].indexOf(t)!==-1}removeEventListener(e,t){if(this._listeners===void 0)return;const r=this._listeners[e];if(r!==void 0){const s=r.indexOf(t);s!==-1&&r.splice(s,1)}}dispatchEvent(e){if(this._listeners===void 0)return;const i=this._listeners[e.type];if(i!==void 0){e.target=this;const r=i.slice(0);for(let s=0,o=r.length;s<o;s++)r[s].call(this,e);e.target=null}}}const on=["00","01","02","03","04","05","06","07","08","09","0a","0b","0c","0d","0e","0f","10","11","12","13","14","15","16","17","18","19","1a","1b","1c","1d","1e","1f","20","21","22","23","24","25","26","27","28","29","2a","2b","2c","2d","2e","2f","30","31","32","33","34","35","36","37","38","39","3a","3b","3c","3d","3e","3f","40","41","42","43","44","45","46","47","48","49","4a","4b","4c","4d","4e","4f","50","51","52","53","54","55","56","57","58","59","5a","5b","5c","5d","5e","5f","60","61","62","63","64","65","66","67","68","69","6a","6b","6c","6d","6e","6f","70","71","72","73","74","75","76","77","78","79","7a","7b","7c","7d","7e","7f","80","81","82","83","84","85","86","87","88","89","8a","8b","8c","8d","8e","8f","90","91","92","93","94","95","96","97","98","99","9a","9b","9c","9d","9e","9f","a0","a1","a2","a3","a4","a5","a6","a7","a8","a9","aa","ab","ac","ad","ae","af","b0","b1","b2","b3","b4","b5","b6","b7","b8","b9","ba","bb","bc","bd","be","bf","c0","c1","c2","c3","c4","c5","c6","c7","c8","c9","ca","cb","cc","cd","ce","cf","d0","d1","d2","d3","d4","d5","d6","d7","d8","d9","da","db","dc","dd","de","df","e0","e1","e2","e3","e4","e5","e6","e7","e8","e9","ea","eb","ec","ed","ee","ef","f0","f1","f2","f3","f4","f5","f6","f7","f8","f9","fa","fb","fc","fd","fe","ff"];let Od=1234567;const so=Math.PI/180,uo=180/Math.PI;function Ts(){const n=Math.random()*4294967295|0,e=Math.random()*4294967295|0,t=Math.random()*4294967295|0,i=Math.random()*4294967295|0;return(on[n&255]+on[n>>8&255]+on[n>>16&255]+on[n>>24&255]+"-"+on[e&255]+on[e>>8&255]+"-"+on[e>>16&15|64]+on[e>>24&255]+"-"+on[t&63|128]+on[t>>8&255]+"-"+on[t>>16&255]+on[t>>24&255]+on[i&255]+on[i>>8&255]+on[i>>16&255]+on[i>>24&255]).toLowerCase()}function Qt(n,e,t){return Math.max(e,Math.min(t,n))}function Cu(n,e){return(n%e+e)%e}function Yg(n,e,t,i,r){return i+(n-e)*(r-i)/(t-e)}function Zg(n,e,t){return n!==e?(t-n)/(e-n):0}function oo(n,e,t){return(1-t)*n+t*e}function Kg(n,e,t,i){return oo(n,e,1-Math.exp(-t*i))}function Jg(n,e=1){return e-Math.abs(Cu(n,e*2)-e)}function Qg(n,e,t){return n<=e?0:n>=t?1:(n=(n-e)/(t-e),n*n*(3-2*n))}function e0(n,e,t){return n<=e?0:n>=t?1:(n=(n-e)/(t-e),n*n*n*(n*(n*6-15)+10))}function t0(n,e){return n+Math.floor(Math.random()*(e-n+1))}function n0(n,e){return n+Math.random()*(e-n)}function i0(n){return n*(.5-Math.random())}function r0(n){n!==void 0&&(Od=n);let e=Od+=1831565813;return e=Math.imul(e^e>>>15,e|1),e^=e+Math.imul(e^e>>>7,e|61),((e^e>>>14)>>>0)/4294967296}function s0(n){return n*so}function o0(n){return n*uo}function a0(n){return(n&n-1)===0&&n!==0}function l0(n){return Math.pow(2,Math.ceil(Math.log(n)/Math.LN2))}function c0(n){return Math.pow(2,Math.floor(Math.log(n)/Math.LN2))}function u0(n,e,t,i,r){const s=Math.cos,o=Math.sin,a=s(t/2),l=o(t/2),c=s((e+i)/2),u=o((e+i)/2),d=s((e-i)/2),h=o((e-i)/2),f=s((i-e)/2),_=o((i-e)/2);switch(r){case"XYX":n.set(a*u,l*d,l*h,a*c);break;case"YZY":n.set(l*h,a*u,l*d,a*c);break;case"ZXZ":n.set(l*d,l*h,a*u,a*c);break;case"XZX":n.set(a*u,l*_,l*f,a*c);break;case"YXY":n.set(l*f,a*u,l*_,a*c);break;case"ZYZ":n.set(l*_,l*f,a*u,a*c);break;default:console.warn("THREE.MathUtils: .setQuaternionFromProperEuler() encountered an unknown order: "+r)}}function ls(n,e){switch(e.constructor){case Float32Array:return n;case Uint32Array:return n/4294967295;case Uint16Array:return n/65535;case Uint8Array:return n/255;case Int32Array:return Math.max(n/2147483647,-1);case Int16Array:return Math.max(n/32767,-1);case Int8Array:return Math.max(n/127,-1);default:throw new Error("Invalid component type.")}}function fn(n,e){switch(e.constructor){case Float32Array:return n;case Uint32Array:return Math.round(n*4294967295);case Uint16Array:return Math.round(n*65535);case Uint8Array:return Math.round(n*255);case Int32Array:return Math.round(n*2147483647);case Int16Array:return Math.round(n*32767);case Int8Array:return Math.round(n*127);default:throw new Error("Invalid component type.")}}const Nt={DEG2RAD:so,RAD2DEG:uo,generateUUID:Ts,clamp:Qt,euclideanModulo:Cu,mapLinear:Yg,inverseLerp:Zg,lerp:oo,damp:Kg,pingpong:Jg,smoothstep:Qg,smootherstep:e0,randInt:t0,randFloat:n0,randFloatSpread:i0,seededRandom:r0,degToRad:s0,radToDeg:o0,isPowerOfTwo:a0,ceilPowerOfTwo:l0,floorPowerOfTwo:c0,setQuaternionFromProperEuler:u0,normalize:fn,denormalize:ls};class Xe{constructor(e=0,t=0){Xe.prototype.isVector2=!0,this.x=e,this.y=t}get width(){return this.x}set width(e){this.x=e}get height(){return this.y}set height(e){this.y=e}set(e,t){return this.x=e,this.y=t,this}setScalar(e){return this.x=e,this.y=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y)}copy(e){return this.x=e.x,this.y=e.y,this}add(e){return this.x+=e.x,this.y+=e.y,this}addScalar(e){return this.x+=e,this.y+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this}subScalar(e){return this.x-=e,this.y-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this}multiply(e){return this.x*=e.x,this.y*=e.y,this}multiplyScalar(e){return this.x*=e,this.y*=e,this}divide(e){return this.x/=e.x,this.y/=e.y,this}divideScalar(e){return this.multiplyScalar(1/e)}applyMatrix3(e){const t=this.x,i=this.y,r=e.elements;return this.x=r[0]*t+r[3]*i+r[6],this.y=r[1]*t+r[4]*i+r[7],this}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this}clamp(e,t){return this.x=Math.max(e.x,Math.min(t.x,this.x)),this.y=Math.max(e.y,Math.min(t.y,this.y)),this}clampScalar(e,t){return this.x=Math.max(e,Math.min(t,this.x)),this.y=Math.max(e,Math.min(t,this.y)),this}clampLength(e,t){const i=this.length();return this.divideScalar(i||1).multiplyScalar(Math.max(e,Math.min(t,i)))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this}negate(){return this.x=-this.x,this.y=-this.y,this}dot(e){return this.x*e.x+this.y*e.y}cross(e){return this.x*e.y-this.y*e.x}lengthSq(){return this.x*this.x+this.y*this.y}length(){return Math.sqrt(this.x*this.x+this.y*this.y)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)}normalize(){return this.divideScalar(this.length()||1)}angle(){return Math.atan2(-this.y,-this.x)+Math.PI}angleTo(e){const t=Math.sqrt(this.lengthSq()*e.lengthSq());if(t===0)return Math.PI/2;const i=this.dot(e)/t;return Math.acos(Qt(i,-1,1))}distanceTo(e){return Math.sqrt(this.distanceToSquared(e))}distanceToSquared(e){const t=this.x-e.x,i=this.y-e.y;return t*t+i*i}manhattanDistanceTo(e){return Math.abs(this.x-e.x)+Math.abs(this.y-e.y)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this}lerpVectors(e,t,i){return this.x=e.x+(t.x-e.x)*i,this.y=e.y+(t.y-e.y)*i,this}equals(e){return e.x===this.x&&e.y===this.y}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this}rotateAround(e,t){const i=Math.cos(t),r=Math.sin(t),s=this.x-e.x,o=this.y-e.y;return this.x=s*i-o*r+e.x,this.y=s*r+o*i+e.y,this}random(){return this.x=Math.random(),this.y=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y}}class rt{constructor(e,t,i,r,s,o,a,l,c){rt.prototype.isMatrix3=!0,this.elements=[1,0,0,0,1,0,0,0,1],e!==void 0&&this.set(e,t,i,r,s,o,a,l,c)}set(e,t,i,r,s,o,a,l,c){const u=this.elements;return u[0]=e,u[1]=r,u[2]=a,u[3]=t,u[4]=s,u[5]=l,u[6]=i,u[7]=o,u[8]=c,this}identity(){return this.set(1,0,0,0,1,0,0,0,1),this}copy(e){const t=this.elements,i=e.elements;return t[0]=i[0],t[1]=i[1],t[2]=i[2],t[3]=i[3],t[4]=i[4],t[5]=i[5],t[6]=i[6],t[7]=i[7],t[8]=i[8],this}extractBasis(e,t,i){return e.setFromMatrix3Column(this,0),t.setFromMatrix3Column(this,1),i.setFromMatrix3Column(this,2),this}setFromMatrix4(e){const t=e.elements;return this.set(t[0],t[4],t[8],t[1],t[5],t[9],t[2],t[6],t[10]),this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,t){const i=e.elements,r=t.elements,s=this.elements,o=i[0],a=i[3],l=i[6],c=i[1],u=i[4],d=i[7],h=i[2],f=i[5],_=i[8],v=r[0],g=r[3],m=r[6],y=r[1],S=r[4],M=r[7],R=r[2],A=r[5],C=r[8];return s[0]=o*v+a*y+l*R,s[3]=o*g+a*S+l*A,s[6]=o*m+a*M+l*C,s[1]=c*v+u*y+d*R,s[4]=c*g+u*S+d*A,s[7]=c*m+u*M+d*C,s[2]=h*v+f*y+_*R,s[5]=h*g+f*S+_*A,s[8]=h*m+f*M+_*C,this}multiplyScalar(e){const t=this.elements;return t[0]*=e,t[3]*=e,t[6]*=e,t[1]*=e,t[4]*=e,t[7]*=e,t[2]*=e,t[5]*=e,t[8]*=e,this}determinant(){const e=this.elements,t=e[0],i=e[1],r=e[2],s=e[3],o=e[4],a=e[5],l=e[6],c=e[7],u=e[8];return t*o*u-t*a*c-i*s*u+i*a*l+r*s*c-r*o*l}invert(){const e=this.elements,t=e[0],i=e[1],r=e[2],s=e[3],o=e[4],a=e[5],l=e[6],c=e[7],u=e[8],d=u*o-a*c,h=a*l-u*s,f=c*s-o*l,_=t*d+i*h+r*f;if(_===0)return this.set(0,0,0,0,0,0,0,0,0);const v=1/_;return e[0]=d*v,e[1]=(r*c-u*i)*v,e[2]=(a*i-r*o)*v,e[3]=h*v,e[4]=(u*t-r*l)*v,e[5]=(r*s-a*t)*v,e[6]=f*v,e[7]=(i*l-c*t)*v,e[8]=(o*t-i*s)*v,this}transpose(){let e;const t=this.elements;return e=t[1],t[1]=t[3],t[3]=e,e=t[2],t[2]=t[6],t[6]=e,e=t[5],t[5]=t[7],t[7]=e,this}getNormalMatrix(e){return this.setFromMatrix4(e).invert().transpose()}transposeIntoArray(e){const t=this.elements;return e[0]=t[0],e[1]=t[3],e[2]=t[6],e[3]=t[1],e[4]=t[4],e[5]=t[7],e[6]=t[2],e[7]=t[5],e[8]=t[8],this}setUvTransform(e,t,i,r,s,o,a){const l=Math.cos(s),c=Math.sin(s);return this.set(i*l,i*c,-i*(l*o+c*a)+o+e,-r*c,r*l,-r*(-c*o+l*a)+a+t,0,0,1),this}scale(e,t){return this.premultiply(gl.makeScale(e,t)),this}rotate(e){return this.premultiply(gl.makeRotation(-e)),this}translate(e,t){return this.premultiply(gl.makeTranslation(e,t)),this}makeTranslation(e,t){return e.isVector2?this.set(1,0,e.x,0,1,e.y,0,0,1):this.set(1,0,e,0,1,t,0,0,1),this}makeRotation(e){const t=Math.cos(e),i=Math.sin(e);return this.set(t,-i,0,i,t,0,0,0,1),this}makeScale(e,t){return this.set(e,0,0,0,t,0,0,0,1),this}equals(e){const t=this.elements,i=e.elements;for(let r=0;r<9;r++)if(t[r]!==i[r])return!1;return!0}fromArray(e,t=0){for(let i=0;i<9;i++)this.elements[i]=e[i+t];return this}toArray(e=[],t=0){const i=this.elements;return e[t]=i[0],e[t+1]=i[1],e[t+2]=i[2],e[t+3]=i[3],e[t+4]=i[4],e[t+5]=i[5],e[t+6]=i[6],e[t+7]=i[7],e[t+8]=i[8],e}clone(){return new this.constructor().fromArray(this.elements)}}const gl=new rt;function sp(n){for(let e=n.length-1;e>=0;--e)if(n[e]>=65535)return!0;return!1}function ho(n){return document.createElementNS("http://www.w3.org/1999/xhtml",n)}function d0(){const n=ho("canvas");return n.style.display="block",n}const Bd={};function Pa(n){n in Bd||(Bd[n]=!0,console.warn(n))}function h0(n,e,t){return new Promise(function(i,r){function s(){switch(n.clientWaitSync(e,n.SYNC_FLUSH_COMMANDS_BIT,0)){case n.WAIT_FAILED:r();break;case n.TIMEOUT_EXPIRED:setTimeout(s,t);break;default:i()}}setTimeout(s,t)})}function f0(n){const e=n.elements;e[2]=.5*e[2]+.5*e[3],e[6]=.5*e[6]+.5*e[7],e[10]=.5*e[10]+.5*e[11],e[14]=.5*e[14]+.5*e[15]}function p0(n){const e=n.elements;e[11]===-1?(e[10]=-e[10]-1,e[14]=-e[14]):(e[10]=-e[10],e[14]=-e[14]+1)}const kd=new rt().set(.8224621,.177538,0,.0331941,.9668058,0,.0170827,.0723974,.9105199),zd=new rt().set(1.2249401,-.2249404,0,-.0420569,1.0420571,0,-.0196376,-.0786361,1.0982735),Bs={[rr]:{transfer:Da,primaries:Na,luminanceCoefficients:[.2126,.7152,.0722],toReference:n=>n,fromReference:n=>n},[Ln]:{transfer:bt,primaries:Na,luminanceCoefficients:[.2126,.7152,.0722],toReference:n=>n.convertSRGBToLinear(),fromReference:n=>n.convertLinearToSRGB()},[Wa]:{transfer:Da,primaries:Ua,luminanceCoefficients:[.2289,.6917,.0793],toReference:n=>n.applyMatrix3(zd),fromReference:n=>n.applyMatrix3(kd)},[Au]:{transfer:bt,primaries:Ua,luminanceCoefficients:[.2289,.6917,.0793],toReference:n=>n.convertSRGBToLinear().applyMatrix3(zd),fromReference:n=>n.applyMatrix3(kd).convertLinearToSRGB()}},m0=new Set([rr,Wa]),ft={enabled:!0,_workingColorSpace:rr,get workingColorSpace(){return this._workingColorSpace},set workingColorSpace(n){if(!m0.has(n))throw new Error(`Unsupported working color space, "${n}".`);this._workingColorSpace=n},convert:function(n,e,t){if(this.enabled===!1||e===t||!e||!t)return n;const i=Bs[e].toReference,r=Bs[t].fromReference;return r(i(n))},fromWorkingColorSpace:function(n,e){return this.convert(n,this._workingColorSpace,e)},toWorkingColorSpace:function(n,e){return this.convert(n,e,this._workingColorSpace)},getPrimaries:function(n){return Bs[n].primaries},getTransfer:function(n){return n===oi?Da:Bs[n].transfer},getLuminanceCoefficients:function(n,e=this._workingColorSpace){return n.fromArray(Bs[e].luminanceCoefficients)}};function vs(n){return n<.04045?n*.0773993808:Math.pow(n*.9478672986+.0521327014,2.4)}function _l(n){return n<.0031308?n*12.92:1.055*Math.pow(n,.41666)-.055}let Or;class g0{static getDataURL(e){if(/^data:/i.test(e.src)||typeof HTMLCanvasElement>"u")return e.src;let t;if(e instanceof HTMLCanvasElement)t=e;else{Or===void 0&&(Or=ho("canvas")),Or.width=e.width,Or.height=e.height;const i=Or.getContext("2d");e instanceof ImageData?i.putImageData(e,0,0):i.drawImage(e,0,0,e.width,e.height),t=Or}return t.width>2048||t.height>2048?(console.warn("THREE.ImageUtils.getDataURL: Image converted to jpg for performance reasons",e),t.toDataURL("image/jpeg",.6)):t.toDataURL("image/png")}static sRGBToLinear(e){if(typeof HTMLImageElement<"u"&&e instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&e instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&e instanceof ImageBitmap){const t=ho("canvas");t.width=e.width,t.height=e.height;const i=t.getContext("2d");i.drawImage(e,0,0,e.width,e.height);const r=i.getImageData(0,0,e.width,e.height),s=r.data;for(let o=0;o<s.length;o++)s[o]=vs(s[o]/255)*255;return i.putImageData(r,0,0),t}else if(e.data){const t=e.data.slice(0);for(let i=0;i<t.length;i++)t instanceof Uint8Array||t instanceof Uint8ClampedArray?t[i]=Math.floor(vs(t[i]/255)*255):t[i]=vs(t[i]);return{data:t,width:e.width,height:e.height}}else return console.warn("THREE.ImageUtils.sRGBToLinear(): Unsupported image type. No color space conversion applied."),e}}let _0=0;class op{constructor(e=null){this.isSource=!0,Object.defineProperty(this,"id",{value:_0++}),this.uuid=Ts(),this.data=e,this.dataReady=!0,this.version=0}set needsUpdate(e){e===!0&&this.version++}toJSON(e){const t=e===void 0||typeof e=="string";if(!t&&e.images[this.uuid]!==void 0)return e.images[this.uuid];const i={uuid:this.uuid,url:""},r=this.data;if(r!==null){let s;if(Array.isArray(r)){s=[];for(let o=0,a=r.length;o<a;o++)r[o].isDataTexture?s.push(vl(r[o].image)):s.push(vl(r[o]))}else s=vl(r);i.url=s}return t||(e.images[this.uuid]=i),i}}function vl(n){return typeof HTMLImageElement<"u"&&n instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&n instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&n instanceof ImageBitmap?g0.getDataURL(n):n.data?{data:Array.from(n.data),width:n.width,height:n.height,type:n.data.constructor.name}:(console.warn("THREE.Texture: Unable to serialize Texture."),{})}let v0=0;class nn extends Er{constructor(e=nn.DEFAULT_IMAGE,t=nn.DEFAULT_MAPPING,i=Sr,r=Sr,s=zn,o=Ki,a=Vn,l=ci,c=nn.DEFAULT_ANISOTROPY,u=oi){super(),this.isTexture=!0,Object.defineProperty(this,"id",{value:v0++}),this.uuid=Ts(),this.name="",this.source=new op(e),this.mipmaps=[],this.mapping=t,this.channel=0,this.wrapS=i,this.wrapT=r,this.magFilter=s,this.minFilter=o,this.anisotropy=c,this.format=a,this.internalFormat=null,this.type=l,this.offset=new Xe(0,0),this.repeat=new Xe(1,1),this.center=new Xe(0,0),this.rotation=0,this.matrixAutoUpdate=!0,this.matrix=new rt,this.generateMipmaps=!0,this.premultiplyAlpha=!1,this.flipY=!0,this.unpackAlignment=4,this.colorSpace=u,this.userData={},this.version=0,this.onUpdate=null,this.isRenderTargetTexture=!1,this.pmremVersion=0}get image(){return this.source.data}set image(e=null){this.source.data=e}updateMatrix(){this.matrix.setUvTransform(this.offset.x,this.offset.y,this.repeat.x,this.repeat.y,this.rotation,this.center.x,this.center.y)}clone(){return new this.constructor().copy(this)}copy(e){return this.name=e.name,this.source=e.source,this.mipmaps=e.mipmaps.slice(0),this.mapping=e.mapping,this.channel=e.channel,this.wrapS=e.wrapS,this.wrapT=e.wrapT,this.magFilter=e.magFilter,this.minFilter=e.minFilter,this.anisotropy=e.anisotropy,this.format=e.format,this.internalFormat=e.internalFormat,this.type=e.type,this.offset.copy(e.offset),this.repeat.copy(e.repeat),this.center.copy(e.center),this.rotation=e.rotation,this.matrixAutoUpdate=e.matrixAutoUpdate,this.matrix.copy(e.matrix),this.generateMipmaps=e.generateMipmaps,this.premultiplyAlpha=e.premultiplyAlpha,this.flipY=e.flipY,this.unpackAlignment=e.unpackAlignment,this.colorSpace=e.colorSpace,this.userData=JSON.parse(JSON.stringify(e.userData)),this.needsUpdate=!0,this}toJSON(e){const t=e===void 0||typeof e=="string";if(!t&&e.textures[this.uuid]!==void 0)return e.textures[this.uuid];const i={metadata:{version:4.6,type:"Texture",generator:"Texture.toJSON"},uuid:this.uuid,name:this.name,image:this.source.toJSON(e).uuid,mapping:this.mapping,channel:this.channel,repeat:[this.repeat.x,this.repeat.y],offset:[this.offset.x,this.offset.y],center:[this.center.x,this.center.y],rotation:this.rotation,wrap:[this.wrapS,this.wrapT],format:this.format,internalFormat:this.internalFormat,type:this.type,colorSpace:this.colorSpace,minFilter:this.minFilter,magFilter:this.magFilter,anisotropy:this.anisotropy,flipY:this.flipY,generateMipmaps:this.generateMipmaps,premultiplyAlpha:this.premultiplyAlpha,unpackAlignment:this.unpackAlignment};return Object.keys(this.userData).length>0&&(i.userData=this.userData),t||(e.textures[this.uuid]=i),i}dispose(){this.dispatchEvent({type:"dispose"})}transformUv(e){if(this.mapping!==Xf)return e;if(e.applyMatrix3(this.matrix),e.x<0||e.x>1)switch(this.wrapS){case wi:e.x=e.x-Math.floor(e.x);break;case Sr:e.x=e.x<0?0:1;break;case Ec:Math.abs(Math.floor(e.x)%2)===1?e.x=Math.ceil(e.x)-e.x:e.x=e.x-Math.floor(e.x);break}if(e.y<0||e.y>1)switch(this.wrapT){case wi:e.y=e.y-Math.floor(e.y);break;case Sr:e.y=e.y<0?0:1;break;case Ec:Math.abs(Math.floor(e.y)%2)===1?e.y=Math.ceil(e.y)-e.y:e.y=e.y-Math.floor(e.y);break}return this.flipY&&(e.y=1-e.y),e}set needsUpdate(e){e===!0&&(this.version++,this.source.needsUpdate=!0)}set needsPMREMUpdate(e){e===!0&&this.pmremVersion++}}nn.DEFAULT_IMAGE=null;nn.DEFAULT_MAPPING=Xf;nn.DEFAULT_ANISOTROPY=1;class Rt{constructor(e=0,t=0,i=0,r=1){Rt.prototype.isVector4=!0,this.x=e,this.y=t,this.z=i,this.w=r}get width(){return this.z}set width(e){this.z=e}get height(){return this.w}set height(e){this.w=e}set(e,t,i,r){return this.x=e,this.y=t,this.z=i,this.w=r,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this.w=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setW(e){return this.w=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;case 2:this.z=t;break;case 3:this.w=t;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;case 3:return this.w;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y,this.z,this.w)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this.w=e.w!==void 0?e.w:1,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this.w+=e.w,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this.w+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this.z=e.z+t.z,this.w=e.w+t.w,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this.z+=e.z*t,this.w+=e.w*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this.w-=e.w,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this.w-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this.z=e.z-t.z,this.w=e.w-t.w,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this.w*=e.w,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this.w*=e,this}applyMatrix4(e){const t=this.x,i=this.y,r=this.z,s=this.w,o=e.elements;return this.x=o[0]*t+o[4]*i+o[8]*r+o[12]*s,this.y=o[1]*t+o[5]*i+o[9]*r+o[13]*s,this.z=o[2]*t+o[6]*i+o[10]*r+o[14]*s,this.w=o[3]*t+o[7]*i+o[11]*r+o[15]*s,this}divideScalar(e){return this.multiplyScalar(1/e)}setAxisAngleFromQuaternion(e){this.w=2*Math.acos(e.w);const t=Math.sqrt(1-e.w*e.w);return t<1e-4?(this.x=1,this.y=0,this.z=0):(this.x=e.x/t,this.y=e.y/t,this.z=e.z/t),this}setAxisAngleFromRotationMatrix(e){let t,i,r,s;const l=e.elements,c=l[0],u=l[4],d=l[8],h=l[1],f=l[5],_=l[9],v=l[2],g=l[6],m=l[10];if(Math.abs(u-h)<.01&&Math.abs(d-v)<.01&&Math.abs(_-g)<.01){if(Math.abs(u+h)<.1&&Math.abs(d+v)<.1&&Math.abs(_+g)<.1&&Math.abs(c+f+m-3)<.1)return this.set(1,0,0,0),this;t=Math.PI;const S=(c+1)/2,M=(f+1)/2,R=(m+1)/2,A=(u+h)/4,C=(d+v)/4,D=(_+g)/4;return S>M&&S>R?S<.01?(i=0,r=.707106781,s=.707106781):(i=Math.sqrt(S),r=A/i,s=C/i):M>R?M<.01?(i=.707106781,r=0,s=.707106781):(r=Math.sqrt(M),i=A/r,s=D/r):R<.01?(i=.707106781,r=.707106781,s=0):(s=Math.sqrt(R),i=C/s,r=D/s),this.set(i,r,s,t),this}let y=Math.sqrt((g-_)*(g-_)+(d-v)*(d-v)+(h-u)*(h-u));return Math.abs(y)<.001&&(y=1),this.x=(g-_)/y,this.y=(d-v)/y,this.z=(h-u)/y,this.w=Math.acos((c+f+m-1)/2),this}setFromMatrixPosition(e){const t=e.elements;return this.x=t[12],this.y=t[13],this.z=t[14],this.w=t[15],this}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this.w=Math.min(this.w,e.w),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this.w=Math.max(this.w,e.w),this}clamp(e,t){return this.x=Math.max(e.x,Math.min(t.x,this.x)),this.y=Math.max(e.y,Math.min(t.y,this.y)),this.z=Math.max(e.z,Math.min(t.z,this.z)),this.w=Math.max(e.w,Math.min(t.w,this.w)),this}clampScalar(e,t){return this.x=Math.max(e,Math.min(t,this.x)),this.y=Math.max(e,Math.min(t,this.y)),this.z=Math.max(e,Math.min(t,this.z)),this.w=Math.max(e,Math.min(t,this.w)),this}clampLength(e,t){const i=this.length();return this.divideScalar(i||1).multiplyScalar(Math.max(e,Math.min(t,i)))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this.w=Math.floor(this.w),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this.w=Math.ceil(this.w),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this.w=Math.round(this.w),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this.w=Math.trunc(this.w),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this.w=-this.w,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z+this.w*e.w}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)+Math.abs(this.w)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this.z+=(e.z-this.z)*t,this.w+=(e.w-this.w)*t,this}lerpVectors(e,t,i){return this.x=e.x+(t.x-e.x)*i,this.y=e.y+(t.y-e.y)*i,this.z=e.z+(t.z-e.z)*i,this.w=e.w+(t.w-e.w)*i,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z&&e.w===this.w}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this.z=e[t+2],this.w=e[t+3],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e[t+2]=this.z,e[t+3]=this.w,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this.z=e.getZ(t),this.w=e.getW(t),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this.w=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z,yield this.w}}class y0 extends Er{constructor(e=1,t=1,i={}){super(),this.isRenderTarget=!0,this.width=e,this.height=t,this.depth=1,this.scissor=new Rt(0,0,e,t),this.scissorTest=!1,this.viewport=new Rt(0,0,e,t);const r={width:e,height:t,depth:1};i=Object.assign({generateMipmaps:!1,internalFormat:null,minFilter:zn,depthBuffer:!0,stencilBuffer:!1,resolveDepthBuffer:!0,resolveStencilBuffer:!0,depthTexture:null,samples:0,count:1},i);const s=new nn(r,i.mapping,i.wrapS,i.wrapT,i.magFilter,i.minFilter,i.format,i.type,i.anisotropy,i.colorSpace);s.flipY=!1,s.generateMipmaps=i.generateMipmaps,s.internalFormat=i.internalFormat,this.textures=[];const o=i.count;for(let a=0;a<o;a++)this.textures[a]=s.clone(),this.textures[a].isRenderTargetTexture=!0;this.depthBuffer=i.depthBuffer,this.stencilBuffer=i.stencilBuffer,this.resolveDepthBuffer=i.resolveDepthBuffer,this.resolveStencilBuffer=i.resolveStencilBuffer,this.depthTexture=i.depthTexture,this.samples=i.samples}get texture(){return this.textures[0]}set texture(e){this.textures[0]=e}setSize(e,t,i=1){if(this.width!==e||this.height!==t||this.depth!==i){this.width=e,this.height=t,this.depth=i;for(let r=0,s=this.textures.length;r<s;r++)this.textures[r].image.width=e,this.textures[r].image.height=t,this.textures[r].image.depth=i;this.dispose()}this.viewport.set(0,0,e,t),this.scissor.set(0,0,e,t)}clone(){return new this.constructor().copy(this)}copy(e){this.width=e.width,this.height=e.height,this.depth=e.depth,this.scissor.copy(e.scissor),this.scissorTest=e.scissorTest,this.viewport.copy(e.viewport),this.textures.length=0;for(let i=0,r=e.textures.length;i<r;i++)this.textures[i]=e.textures[i].clone(),this.textures[i].isRenderTargetTexture=!0;const t=Object.assign({},e.texture.image);return this.texture.source=new op(t),this.depthBuffer=e.depthBuffer,this.stencilBuffer=e.stencilBuffer,this.resolveDepthBuffer=e.resolveDepthBuffer,this.resolveStencilBuffer=e.resolveStencilBuffer,e.depthTexture!==null&&(this.depthTexture=e.depthTexture.clone()),this.samples=e.samples,this}dispose(){this.dispatchEvent({type:"dispose"})}}class nr extends y0{constructor(e=1,t=1,i={}){super(e,t,i),this.isWebGLRenderTarget=!0}}class Pu extends nn{constructor(e=null,t=1,i=1,r=1){super(null),this.isDataArrayTexture=!0,this.image={data:e,width:t,height:i,depth:r},this.magFilter=Hn,this.minFilter=Hn,this.wrapR=Sr,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1,this.layerUpdates=new Set}addLayerUpdate(e){this.layerUpdates.add(e)}clearLayerUpdates(){this.layerUpdates.clear()}}class x0 extends nn{constructor(e=null,t=1,i=1,r=1){super(null),this.isData3DTexture=!0,this.image={data:e,width:t,height:i,depth:r},this.magFilter=Hn,this.minFilter=Hn,this.wrapR=Sr,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}}class wr{constructor(e=0,t=0,i=0,r=1){this.isQuaternion=!0,this._x=e,this._y=t,this._z=i,this._w=r}static slerpFlat(e,t,i,r,s,o,a){let l=i[r+0],c=i[r+1],u=i[r+2],d=i[r+3];const h=s[o+0],f=s[o+1],_=s[o+2],v=s[o+3];if(a===0){e[t+0]=l,e[t+1]=c,e[t+2]=u,e[t+3]=d;return}if(a===1){e[t+0]=h,e[t+1]=f,e[t+2]=_,e[t+3]=v;return}if(d!==v||l!==h||c!==f||u!==_){let g=1-a;const m=l*h+c*f+u*_+d*v,y=m>=0?1:-1,S=1-m*m;if(S>Number.EPSILON){const R=Math.sqrt(S),A=Math.atan2(R,m*y);g=Math.sin(g*A)/R,a=Math.sin(a*A)/R}const M=a*y;if(l=l*g+h*M,c=c*g+f*M,u=u*g+_*M,d=d*g+v*M,g===1-a){const R=1/Math.sqrt(l*l+c*c+u*u+d*d);l*=R,c*=R,u*=R,d*=R}}e[t]=l,e[t+1]=c,e[t+2]=u,e[t+3]=d}static multiplyQuaternionsFlat(e,t,i,r,s,o){const a=i[r],l=i[r+1],c=i[r+2],u=i[r+3],d=s[o],h=s[o+1],f=s[o+2],_=s[o+3];return e[t]=a*_+u*d+l*f-c*h,e[t+1]=l*_+u*h+c*d-a*f,e[t+2]=c*_+u*f+a*h-l*d,e[t+3]=u*_-a*d-l*h-c*f,e}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get w(){return this._w}set w(e){this._w=e,this._onChangeCallback()}set(e,t,i,r){return this._x=e,this._y=t,this._z=i,this._w=r,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._w)}copy(e){return this._x=e.x,this._y=e.y,this._z=e.z,this._w=e.w,this._onChangeCallback(),this}setFromEuler(e,t=!0){const i=e._x,r=e._y,s=e._z,o=e._order,a=Math.cos,l=Math.sin,c=a(i/2),u=a(r/2),d=a(s/2),h=l(i/2),f=l(r/2),_=l(s/2);switch(o){case"XYZ":this._x=h*u*d+c*f*_,this._y=c*f*d-h*u*_,this._z=c*u*_+h*f*d,this._w=c*u*d-h*f*_;break;case"YXZ":this._x=h*u*d+c*f*_,this._y=c*f*d-h*u*_,this._z=c*u*_-h*f*d,this._w=c*u*d+h*f*_;break;case"ZXY":this._x=h*u*d-c*f*_,this._y=c*f*d+h*u*_,this._z=c*u*_+h*f*d,this._w=c*u*d-h*f*_;break;case"ZYX":this._x=h*u*d-c*f*_,this._y=c*f*d+h*u*_,this._z=c*u*_-h*f*d,this._w=c*u*d+h*f*_;break;case"YZX":this._x=h*u*d+c*f*_,this._y=c*f*d+h*u*_,this._z=c*u*_-h*f*d,this._w=c*u*d-h*f*_;break;case"XZY":this._x=h*u*d-c*f*_,this._y=c*f*d-h*u*_,this._z=c*u*_+h*f*d,this._w=c*u*d+h*f*_;break;default:console.warn("THREE.Quaternion: .setFromEuler() encountered an unknown order: "+o)}return t===!0&&this._onChangeCallback(),this}setFromAxisAngle(e,t){const i=t/2,r=Math.sin(i);return this._x=e.x*r,this._y=e.y*r,this._z=e.z*r,this._w=Math.cos(i),this._onChangeCallback(),this}setFromRotationMatrix(e){const t=e.elements,i=t[0],r=t[4],s=t[8],o=t[1],a=t[5],l=t[9],c=t[2],u=t[6],d=t[10],h=i+a+d;if(h>0){const f=.5/Math.sqrt(h+1);this._w=.25/f,this._x=(u-l)*f,this._y=(s-c)*f,this._z=(o-r)*f}else if(i>a&&i>d){const f=2*Math.sqrt(1+i-a-d);this._w=(u-l)/f,this._x=.25*f,this._y=(r+o)/f,this._z=(s+c)/f}else if(a>d){const f=2*Math.sqrt(1+a-i-d);this._w=(s-c)/f,this._x=(r+o)/f,this._y=.25*f,this._z=(l+u)/f}else{const f=2*Math.sqrt(1+d-i-a);this._w=(o-r)/f,this._x=(s+c)/f,this._y=(l+u)/f,this._z=.25*f}return this._onChangeCallback(),this}setFromUnitVectors(e,t){let i=e.dot(t)+1;return i<Number.EPSILON?(i=0,Math.abs(e.x)>Math.abs(e.z)?(this._x=-e.y,this._y=e.x,this._z=0,this._w=i):(this._x=0,this._y=-e.z,this._z=e.y,this._w=i)):(this._x=e.y*t.z-e.z*t.y,this._y=e.z*t.x-e.x*t.z,this._z=e.x*t.y-e.y*t.x,this._w=i),this.normalize()}angleTo(e){return 2*Math.acos(Math.abs(Qt(this.dot(e),-1,1)))}rotateTowards(e,t){const i=this.angleTo(e);if(i===0)return this;const r=Math.min(1,t/i);return this.slerp(e,r),this}identity(){return this.set(0,0,0,1)}invert(){return this.conjugate()}conjugate(){return this._x*=-1,this._y*=-1,this._z*=-1,this._onChangeCallback(),this}dot(e){return this._x*e._x+this._y*e._y+this._z*e._z+this._w*e._w}lengthSq(){return this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w}length(){return Math.sqrt(this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w)}normalize(){let e=this.length();return e===0?(this._x=0,this._y=0,this._z=0,this._w=1):(e=1/e,this._x=this._x*e,this._y=this._y*e,this._z=this._z*e,this._w=this._w*e),this._onChangeCallback(),this}multiply(e){return this.multiplyQuaternions(this,e)}premultiply(e){return this.multiplyQuaternions(e,this)}multiplyQuaternions(e,t){const i=e._x,r=e._y,s=e._z,o=e._w,a=t._x,l=t._y,c=t._z,u=t._w;return this._x=i*u+o*a+r*c-s*l,this._y=r*u+o*l+s*a-i*c,this._z=s*u+o*c+i*l-r*a,this._w=o*u-i*a-r*l-s*c,this._onChangeCallback(),this}slerp(e,t){if(t===0)return this;if(t===1)return this.copy(e);const i=this._x,r=this._y,s=this._z,o=this._w;let a=o*e._w+i*e._x+r*e._y+s*e._z;if(a<0?(this._w=-e._w,this._x=-e._x,this._y=-e._y,this._z=-e._z,a=-a):this.copy(e),a>=1)return this._w=o,this._x=i,this._y=r,this._z=s,this;const l=1-a*a;if(l<=Number.EPSILON){const f=1-t;return this._w=f*o+t*this._w,this._x=f*i+t*this._x,this._y=f*r+t*this._y,this._z=f*s+t*this._z,this.normalize(),this}const c=Math.sqrt(l),u=Math.atan2(c,a),d=Math.sin((1-t)*u)/c,h=Math.sin(t*u)/c;return this._w=o*d+this._w*h,this._x=i*d+this._x*h,this._y=r*d+this._y*h,this._z=s*d+this._z*h,this._onChangeCallback(),this}slerpQuaternions(e,t,i){return this.copy(e).slerp(t,i)}random(){const e=2*Math.PI*Math.random(),t=2*Math.PI*Math.random(),i=Math.random(),r=Math.sqrt(1-i),s=Math.sqrt(i);return this.set(r*Math.sin(e),r*Math.cos(e),s*Math.sin(t),s*Math.cos(t))}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._w===this._w}fromArray(e,t=0){return this._x=e[t],this._y=e[t+1],this._z=e[t+2],this._w=e[t+3],this._onChangeCallback(),this}toArray(e=[],t=0){return e[t]=this._x,e[t+1]=this._y,e[t+2]=this._z,e[t+3]=this._w,e}fromBufferAttribute(e,t){return this._x=e.getX(t),this._y=e.getY(t),this._z=e.getZ(t),this._w=e.getW(t),this._onChangeCallback(),this}toJSON(){return this.toArray()}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._w}}class z{constructor(e=0,t=0,i=0){z.prototype.isVector3=!0,this.x=e,this.y=t,this.z=i}set(e,t,i){return i===void 0&&(i=this.z),this.x=e,this.y=t,this.z=i,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;case 2:this.z=t;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y,this.z)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this.z=e.z+t.z,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this.z+=e.z*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this.z=e.z-t.z,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this}multiplyVectors(e,t){return this.x=e.x*t.x,this.y=e.y*t.y,this.z=e.z*t.z,this}applyEuler(e){return this.applyQuaternion(Hd.setFromEuler(e))}applyAxisAngle(e,t){return this.applyQuaternion(Hd.setFromAxisAngle(e,t))}applyMatrix3(e){const t=this.x,i=this.y,r=this.z,s=e.elements;return this.x=s[0]*t+s[3]*i+s[6]*r,this.y=s[1]*t+s[4]*i+s[7]*r,this.z=s[2]*t+s[5]*i+s[8]*r,this}applyNormalMatrix(e){return this.applyMatrix3(e).normalize()}applyMatrix4(e){const t=this.x,i=this.y,r=this.z,s=e.elements,o=1/(s[3]*t+s[7]*i+s[11]*r+s[15]);return this.x=(s[0]*t+s[4]*i+s[8]*r+s[12])*o,this.y=(s[1]*t+s[5]*i+s[9]*r+s[13])*o,this.z=(s[2]*t+s[6]*i+s[10]*r+s[14])*o,this}applyQuaternion(e){const t=this.x,i=this.y,r=this.z,s=e.x,o=e.y,a=e.z,l=e.w,c=2*(o*r-a*i),u=2*(a*t-s*r),d=2*(s*i-o*t);return this.x=t+l*c+o*d-a*u,this.y=i+l*u+a*c-s*d,this.z=r+l*d+s*u-o*c,this}project(e){return this.applyMatrix4(e.matrixWorldInverse).applyMatrix4(e.projectionMatrix)}unproject(e){return this.applyMatrix4(e.projectionMatrixInverse).applyMatrix4(e.matrixWorld)}transformDirection(e){const t=this.x,i=this.y,r=this.z,s=e.elements;return this.x=s[0]*t+s[4]*i+s[8]*r,this.y=s[1]*t+s[5]*i+s[9]*r,this.z=s[2]*t+s[6]*i+s[10]*r,this.normalize()}divide(e){return this.x/=e.x,this.y/=e.y,this.z/=e.z,this}divideScalar(e){return this.multiplyScalar(1/e)}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this}clamp(e,t){return this.x=Math.max(e.x,Math.min(t.x,this.x)),this.y=Math.max(e.y,Math.min(t.y,this.y)),this.z=Math.max(e.z,Math.min(t.z,this.z)),this}clampScalar(e,t){return this.x=Math.max(e,Math.min(t,this.x)),this.y=Math.max(e,Math.min(t,this.y)),this.z=Math.max(e,Math.min(t,this.z)),this}clampLength(e,t){const i=this.length();return this.divideScalar(i||1).multiplyScalar(Math.max(e,Math.min(t,i)))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this.z+=(e.z-this.z)*t,this}lerpVectors(e,t,i){return this.x=e.x+(t.x-e.x)*i,this.y=e.y+(t.y-e.y)*i,this.z=e.z+(t.z-e.z)*i,this}cross(e){return this.crossVectors(this,e)}crossVectors(e,t){const i=e.x,r=e.y,s=e.z,o=t.x,a=t.y,l=t.z;return this.x=r*l-s*a,this.y=s*o-i*l,this.z=i*a-r*o,this}projectOnVector(e){const t=e.lengthSq();if(t===0)return this.set(0,0,0);const i=e.dot(this)/t;return this.copy(e).multiplyScalar(i)}projectOnPlane(e){return yl.copy(this).projectOnVector(e),this.sub(yl)}reflect(e){return this.sub(yl.copy(e).multiplyScalar(2*this.dot(e)))}angleTo(e){const t=Math.sqrt(this.lengthSq()*e.lengthSq());if(t===0)return Math.PI/2;const i=this.dot(e)/t;return Math.acos(Qt(i,-1,1))}distanceTo(e){return Math.sqrt(this.distanceToSquared(e))}distanceToSquared(e){const t=this.x-e.x,i=this.y-e.y,r=this.z-e.z;return t*t+i*i+r*r}manhattanDistanceTo(e){return Math.abs(this.x-e.x)+Math.abs(this.y-e.y)+Math.abs(this.z-e.z)}setFromSpherical(e){return this.setFromSphericalCoords(e.radius,e.phi,e.theta)}setFromSphericalCoords(e,t,i){const r=Math.sin(t)*e;return this.x=r*Math.sin(i),this.y=Math.cos(t)*e,this.z=r*Math.cos(i),this}setFromCylindrical(e){return this.setFromCylindricalCoords(e.radius,e.theta,e.y)}setFromCylindricalCoords(e,t,i){return this.x=e*Math.sin(t),this.y=i,this.z=e*Math.cos(t),this}setFromMatrixPosition(e){const t=e.elements;return this.x=t[12],this.y=t[13],this.z=t[14],this}setFromMatrixScale(e){const t=this.setFromMatrixColumn(e,0).length(),i=this.setFromMatrixColumn(e,1).length(),r=this.setFromMatrixColumn(e,2).length();return this.x=t,this.y=i,this.z=r,this}setFromMatrixColumn(e,t){return this.fromArray(e.elements,t*4)}setFromMatrix3Column(e,t){return this.fromArray(e.elements,t*3)}setFromEuler(e){return this.x=e._x,this.y=e._y,this.z=e._z,this}setFromColor(e){return this.x=e.r,this.y=e.g,this.z=e.b,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this.z=e[t+2],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e[t+2]=this.z,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this.z=e.getZ(t),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this}randomDirection(){const e=Math.random()*Math.PI*2,t=Math.random()*2-1,i=Math.sqrt(1-t*t);return this.x=i*Math.cos(e),this.y=t,this.z=i*Math.sin(e),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z}}const yl=new z,Hd=new wr;class $t{constructor(e=new z(1/0,1/0,1/0),t=new z(-1/0,-1/0,-1/0)){this.isBox3=!0,this.min=e,this.max=t}set(e,t){return this.min.copy(e),this.max.copy(t),this}setFromArray(e){this.makeEmpty();for(let t=0,i=e.length;t<i;t+=3)this.expandByPoint(qn.fromArray(e,t));return this}setFromBufferAttribute(e){this.makeEmpty();for(let t=0,i=e.count;t<i;t++)this.expandByPoint(qn.fromBufferAttribute(e,t));return this}setFromPoints(e){this.makeEmpty();for(let t=0,i=e.length;t<i;t++)this.expandByPoint(e[t]);return this}setFromCenterAndSize(e,t){const i=qn.copy(t).multiplyScalar(.5);return this.min.copy(e).sub(i),this.max.copy(e).add(i),this}setFromObject(e,t=!1){return this.makeEmpty(),this.expandByObject(e,t)}clone(){return new this.constructor().copy(this)}copy(e){return this.min.copy(e.min),this.max.copy(e.max),this}makeEmpty(){return this.min.x=this.min.y=this.min.z=1/0,this.max.x=this.max.y=this.max.z=-1/0,this}isEmpty(){return this.max.x<this.min.x||this.max.y<this.min.y||this.max.z<this.min.z}getCenter(e){return this.isEmpty()?e.set(0,0,0):e.addVectors(this.min,this.max).multiplyScalar(.5)}getSize(e){return this.isEmpty()?e.set(0,0,0):e.subVectors(this.max,this.min)}expandByPoint(e){return this.min.min(e),this.max.max(e),this}expandByVector(e){return this.min.sub(e),this.max.add(e),this}expandByScalar(e){return this.min.addScalar(-e),this.max.addScalar(e),this}expandByObject(e,t=!1){e.updateWorldMatrix(!1,!1);const i=e.geometry;if(i!==void 0){const s=i.getAttribute("position");if(t===!0&&s!==void 0&&e.isInstancedMesh!==!0)for(let o=0,a=s.count;o<a;o++)e.isMesh===!0?e.getVertexPosition(o,qn):qn.fromBufferAttribute(s,o),qn.applyMatrix4(e.matrixWorld),this.expandByPoint(qn);else e.boundingBox!==void 0?(e.boundingBox===null&&e.computeBoundingBox(),Io.copy(e.boundingBox)):(i.boundingBox===null&&i.computeBoundingBox(),Io.copy(i.boundingBox)),Io.applyMatrix4(e.matrixWorld),this.union(Io)}const r=e.children;for(let s=0,o=r.length;s<o;s++)this.expandByObject(r[s],t);return this}containsPoint(e){return e.x>=this.min.x&&e.x<=this.max.x&&e.y>=this.min.y&&e.y<=this.max.y&&e.z>=this.min.z&&e.z<=this.max.z}containsBox(e){return this.min.x<=e.min.x&&e.max.x<=this.max.x&&this.min.y<=e.min.y&&e.max.y<=this.max.y&&this.min.z<=e.min.z&&e.max.z<=this.max.z}getParameter(e,t){return t.set((e.x-this.min.x)/(this.max.x-this.min.x),(e.y-this.min.y)/(this.max.y-this.min.y),(e.z-this.min.z)/(this.max.z-this.min.z))}intersectsBox(e){return e.max.x>=this.min.x&&e.min.x<=this.max.x&&e.max.y>=this.min.y&&e.min.y<=this.max.y&&e.max.z>=this.min.z&&e.min.z<=this.max.z}intersectsSphere(e){return this.clampPoint(e.center,qn),qn.distanceToSquared(e.center)<=e.radius*e.radius}intersectsPlane(e){let t,i;return e.normal.x>0?(t=e.normal.x*this.min.x,i=e.normal.x*this.max.x):(t=e.normal.x*this.max.x,i=e.normal.x*this.min.x),e.normal.y>0?(t+=e.normal.y*this.min.y,i+=e.normal.y*this.max.y):(t+=e.normal.y*this.max.y,i+=e.normal.y*this.min.y),e.normal.z>0?(t+=e.normal.z*this.min.z,i+=e.normal.z*this.max.z):(t+=e.normal.z*this.max.z,i+=e.normal.z*this.min.z),t<=-e.constant&&i>=-e.constant}intersectsTriangle(e){if(this.isEmpty())return!1;this.getCenter(ks),Do.subVectors(this.max,ks),Br.subVectors(e.a,ks),kr.subVectors(e.b,ks),zr.subVectors(e.c,ks),Bi.subVectors(kr,Br),ki.subVectors(zr,kr),ur.subVectors(Br,zr);let t=[0,-Bi.z,Bi.y,0,-ki.z,ki.y,0,-ur.z,ur.y,Bi.z,0,-Bi.x,ki.z,0,-ki.x,ur.z,0,-ur.x,-Bi.y,Bi.x,0,-ki.y,ki.x,0,-ur.y,ur.x,0];return!xl(t,Br,kr,zr,Do)||(t=[1,0,0,0,1,0,0,0,1],!xl(t,Br,kr,zr,Do))?!1:(No.crossVectors(Bi,ki),t=[No.x,No.y,No.z],xl(t,Br,kr,zr,Do))}clampPoint(e,t){return t.copy(e).clamp(this.min,this.max)}distanceToPoint(e){return this.clampPoint(e,qn).distanceTo(e)}getBoundingSphere(e){return this.isEmpty()?e.makeEmpty():(this.getCenter(e.center),e.radius=this.getSize(qn).length()*.5),e}intersect(e){return this.min.max(e.min),this.max.min(e.max),this.isEmpty()&&this.makeEmpty(),this}union(e){return this.min.min(e.min),this.max.max(e.max),this}applyMatrix4(e){return this.isEmpty()?this:(gi[0].set(this.min.x,this.min.y,this.min.z).applyMatrix4(e),gi[1].set(this.min.x,this.min.y,this.max.z).applyMatrix4(e),gi[2].set(this.min.x,this.max.y,this.min.z).applyMatrix4(e),gi[3].set(this.min.x,this.max.y,this.max.z).applyMatrix4(e),gi[4].set(this.max.x,this.min.y,this.min.z).applyMatrix4(e),gi[5].set(this.max.x,this.min.y,this.max.z).applyMatrix4(e),gi[6].set(this.max.x,this.max.y,this.min.z).applyMatrix4(e),gi[7].set(this.max.x,this.max.y,this.max.z).applyMatrix4(e),this.setFromPoints(gi),this)}translate(e){return this.min.add(e),this.max.add(e),this}equals(e){return e.min.equals(this.min)&&e.max.equals(this.max)}}const gi=[new z,new z,new z,new z,new z,new z,new z,new z],qn=new z,Io=new $t,Br=new z,kr=new z,zr=new z,Bi=new z,ki=new z,ur=new z,ks=new z,Do=new z,No=new z,dr=new z;function xl(n,e,t,i,r){for(let s=0,o=n.length-3;s<=o;s+=3){dr.fromArray(n,s);const a=r.x*Math.abs(dr.x)+r.y*Math.abs(dr.y)+r.z*Math.abs(dr.z),l=e.dot(dr),c=t.dot(dr),u=i.dot(dr);if(Math.max(-Math.max(l,c,u),Math.min(l,c,u))>a)return!1}return!0}const b0=new $t,zs=new z,bl=new z;class As{constructor(e=new z,t=-1){this.isSphere=!0,this.center=e,this.radius=t}set(e,t){return this.center.copy(e),this.radius=t,this}setFromPoints(e,t){const i=this.center;t!==void 0?i.copy(t):b0.setFromPoints(e).getCenter(i);let r=0;for(let s=0,o=e.length;s<o;s++)r=Math.max(r,i.distanceToSquared(e[s]));return this.radius=Math.sqrt(r),this}copy(e){return this.center.copy(e.center),this.radius=e.radius,this}isEmpty(){return this.radius<0}makeEmpty(){return this.center.set(0,0,0),this.radius=-1,this}containsPoint(e){return e.distanceToSquared(this.center)<=this.radius*this.radius}distanceToPoint(e){return e.distanceTo(this.center)-this.radius}intersectsSphere(e){const t=this.radius+e.radius;return e.center.distanceToSquared(this.center)<=t*t}intersectsBox(e){return e.intersectsSphere(this)}intersectsPlane(e){return Math.abs(e.distanceToPoint(this.center))<=this.radius}clampPoint(e,t){const i=this.center.distanceToSquared(e);return t.copy(e),i>this.radius*this.radius&&(t.sub(this.center).normalize(),t.multiplyScalar(this.radius).add(this.center)),t}getBoundingBox(e){return this.isEmpty()?(e.makeEmpty(),e):(e.set(this.center,this.center),e.expandByScalar(this.radius),e)}applyMatrix4(e){return this.center.applyMatrix4(e),this.radius=this.radius*e.getMaxScaleOnAxis(),this}translate(e){return this.center.add(e),this}expandByPoint(e){if(this.isEmpty())return this.center.copy(e),this.radius=0,this;zs.subVectors(e,this.center);const t=zs.lengthSq();if(t>this.radius*this.radius){const i=Math.sqrt(t),r=(i-this.radius)*.5;this.center.addScaledVector(zs,r/i),this.radius+=r}return this}union(e){return e.isEmpty()?this:this.isEmpty()?(this.copy(e),this):(this.center.equals(e.center)===!0?this.radius=Math.max(this.radius,e.radius):(bl.subVectors(e.center,this.center).setLength(e.radius),this.expandByPoint(zs.copy(e.center).add(bl)),this.expandByPoint(zs.copy(e.center).sub(bl))),this)}equals(e){return e.center.equals(this.center)&&e.radius===this.radius}clone(){return new this.constructor().copy(this)}}const _i=new z,Sl=new z,Uo=new z,zi=new z,Ml=new z,Fo=new z,wl=new z;class Ri{constructor(e=new z,t=new z(0,0,-1)){this.origin=e,this.direction=t}set(e,t){return this.origin.copy(e),this.direction.copy(t),this}copy(e){return this.origin.copy(e.origin),this.direction.copy(e.direction),this}at(e,t){return t.copy(this.origin).addScaledVector(this.direction,e)}lookAt(e){return this.direction.copy(e).sub(this.origin).normalize(),this}recast(e){return this.origin.copy(this.at(e,_i)),this}closestPointToPoint(e,t){t.subVectors(e,this.origin);const i=t.dot(this.direction);return i<0?t.copy(this.origin):t.copy(this.origin).addScaledVector(this.direction,i)}distanceToPoint(e){return Math.sqrt(this.distanceSqToPoint(e))}distanceSqToPoint(e){const t=_i.subVectors(e,this.origin).dot(this.direction);return t<0?this.origin.distanceToSquared(e):(_i.copy(this.origin).addScaledVector(this.direction,t),_i.distanceToSquared(e))}distanceSqToSegment(e,t,i,r){Sl.copy(e).add(t).multiplyScalar(.5),Uo.copy(t).sub(e).normalize(),zi.copy(this.origin).sub(Sl);const s=e.distanceTo(t)*.5,o=-this.direction.dot(Uo),a=zi.dot(this.direction),l=-zi.dot(Uo),c=zi.lengthSq(),u=Math.abs(1-o*o);let d,h,f,_;if(u>0)if(d=o*l-a,h=o*a-l,_=s*u,d>=0)if(h>=-_)if(h<=_){const v=1/u;d*=v,h*=v,f=d*(d+o*h+2*a)+h*(o*d+h+2*l)+c}else h=s,d=Math.max(0,-(o*h+a)),f=-d*d+h*(h+2*l)+c;else h=-s,d=Math.max(0,-(o*h+a)),f=-d*d+h*(h+2*l)+c;else h<=-_?(d=Math.max(0,-(-o*s+a)),h=d>0?-s:Math.min(Math.max(-s,-l),s),f=-d*d+h*(h+2*l)+c):h<=_?(d=0,h=Math.min(Math.max(-s,-l),s),f=h*(h+2*l)+c):(d=Math.max(0,-(o*s+a)),h=d>0?s:Math.min(Math.max(-s,-l),s),f=-d*d+h*(h+2*l)+c);else h=o>0?-s:s,d=Math.max(0,-(o*h+a)),f=-d*d+h*(h+2*l)+c;return i&&i.copy(this.origin).addScaledVector(this.direction,d),r&&r.copy(Sl).addScaledVector(Uo,h),f}intersectSphere(e,t){_i.subVectors(e.center,this.origin);const i=_i.dot(this.direction),r=_i.dot(_i)-i*i,s=e.radius*e.radius;if(r>s)return null;const o=Math.sqrt(s-r),a=i-o,l=i+o;return l<0?null:a<0?this.at(l,t):this.at(a,t)}intersectsSphere(e){return this.distanceSqToPoint(e.center)<=e.radius*e.radius}distanceToPlane(e){const t=e.normal.dot(this.direction);if(t===0)return e.distanceToPoint(this.origin)===0?0:null;const i=-(this.origin.dot(e.normal)+e.constant)/t;return i>=0?i:null}intersectPlane(e,t){const i=this.distanceToPlane(e);return i===null?null:this.at(i,t)}intersectsPlane(e){const t=e.distanceToPoint(this.origin);return t===0||e.normal.dot(this.direction)*t<0}intersectBox(e,t){let i,r,s,o,a,l;const c=1/this.direction.x,u=1/this.direction.y,d=1/this.direction.z,h=this.origin;return c>=0?(i=(e.min.x-h.x)*c,r=(e.max.x-h.x)*c):(i=(e.max.x-h.x)*c,r=(e.min.x-h.x)*c),u>=0?(s=(e.min.y-h.y)*u,o=(e.max.y-h.y)*u):(s=(e.max.y-h.y)*u,o=(e.min.y-h.y)*u),i>o||s>r||((s>i||isNaN(i))&&(i=s),(o<r||isNaN(r))&&(r=o),d>=0?(a=(e.min.z-h.z)*d,l=(e.max.z-h.z)*d):(a=(e.max.z-h.z)*d,l=(e.min.z-h.z)*d),i>l||a>r)||((a>i||i!==i)&&(i=a),(l<r||r!==r)&&(r=l),r<0)?null:this.at(i>=0?i:r,t)}intersectsBox(e){return this.intersectBox(e,_i)!==null}intersectTriangle(e,t,i,r,s){Ml.subVectors(t,e),Fo.subVectors(i,e),wl.crossVectors(Ml,Fo);let o=this.direction.dot(wl),a;if(o>0){if(r)return null;a=1}else if(o<0)a=-1,o=-o;else return null;zi.subVectors(this.origin,e);const l=a*this.direction.dot(Fo.crossVectors(zi,Fo));if(l<0)return null;const c=a*this.direction.dot(Ml.cross(zi));if(c<0||l+c>o)return null;const u=-a*zi.dot(wl);return u<0?null:this.at(u/o,s)}applyMatrix4(e){return this.origin.applyMatrix4(e),this.direction.transformDirection(e),this}equals(e){return e.origin.equals(this.origin)&&e.direction.equals(this.direction)}clone(){return new this.constructor().copy(this)}}class ht{constructor(e,t,i,r,s,o,a,l,c,u,d,h,f,_,v,g){ht.prototype.isMatrix4=!0,this.elements=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],e!==void 0&&this.set(e,t,i,r,s,o,a,l,c,u,d,h,f,_,v,g)}set(e,t,i,r,s,o,a,l,c,u,d,h,f,_,v,g){const m=this.elements;return m[0]=e,m[4]=t,m[8]=i,m[12]=r,m[1]=s,m[5]=o,m[9]=a,m[13]=l,m[2]=c,m[6]=u,m[10]=d,m[14]=h,m[3]=f,m[7]=_,m[11]=v,m[15]=g,this}identity(){return this.set(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1),this}clone(){return new ht().fromArray(this.elements)}copy(e){const t=this.elements,i=e.elements;return t[0]=i[0],t[1]=i[1],t[2]=i[2],t[3]=i[3],t[4]=i[4],t[5]=i[5],t[6]=i[6],t[7]=i[7],t[8]=i[8],t[9]=i[9],t[10]=i[10],t[11]=i[11],t[12]=i[12],t[13]=i[13],t[14]=i[14],t[15]=i[15],this}copyPosition(e){const t=this.elements,i=e.elements;return t[12]=i[12],t[13]=i[13],t[14]=i[14],this}setFromMatrix3(e){const t=e.elements;return this.set(t[0],t[3],t[6],0,t[1],t[4],t[7],0,t[2],t[5],t[8],0,0,0,0,1),this}extractBasis(e,t,i){return e.setFromMatrixColumn(this,0),t.setFromMatrixColumn(this,1),i.setFromMatrixColumn(this,2),this}makeBasis(e,t,i){return this.set(e.x,t.x,i.x,0,e.y,t.y,i.y,0,e.z,t.z,i.z,0,0,0,0,1),this}extractRotation(e){const t=this.elements,i=e.elements,r=1/Hr.setFromMatrixColumn(e,0).length(),s=1/Hr.setFromMatrixColumn(e,1).length(),o=1/Hr.setFromMatrixColumn(e,2).length();return t[0]=i[0]*r,t[1]=i[1]*r,t[2]=i[2]*r,t[3]=0,t[4]=i[4]*s,t[5]=i[5]*s,t[6]=i[6]*s,t[7]=0,t[8]=i[8]*o,t[9]=i[9]*o,t[10]=i[10]*o,t[11]=0,t[12]=0,t[13]=0,t[14]=0,t[15]=1,this}makeRotationFromEuler(e){const t=this.elements,i=e.x,r=e.y,s=e.z,o=Math.cos(i),a=Math.sin(i),l=Math.cos(r),c=Math.sin(r),u=Math.cos(s),d=Math.sin(s);if(e.order==="XYZ"){const h=o*u,f=o*d,_=a*u,v=a*d;t[0]=l*u,t[4]=-l*d,t[8]=c,t[1]=f+_*c,t[5]=h-v*c,t[9]=-a*l,t[2]=v-h*c,t[6]=_+f*c,t[10]=o*l}else if(e.order==="YXZ"){const h=l*u,f=l*d,_=c*u,v=c*d;t[0]=h+v*a,t[4]=_*a-f,t[8]=o*c,t[1]=o*d,t[5]=o*u,t[9]=-a,t[2]=f*a-_,t[6]=v+h*a,t[10]=o*l}else if(e.order==="ZXY"){const h=l*u,f=l*d,_=c*u,v=c*d;t[0]=h-v*a,t[4]=-o*d,t[8]=_+f*a,t[1]=f+_*a,t[5]=o*u,t[9]=v-h*a,t[2]=-o*c,t[6]=a,t[10]=o*l}else if(e.order==="ZYX"){const h=o*u,f=o*d,_=a*u,v=a*d;t[0]=l*u,t[4]=_*c-f,t[8]=h*c+v,t[1]=l*d,t[5]=v*c+h,t[9]=f*c-_,t[2]=-c,t[6]=a*l,t[10]=o*l}else if(e.order==="YZX"){const h=o*l,f=o*c,_=a*l,v=a*c;t[0]=l*u,t[4]=v-h*d,t[8]=_*d+f,t[1]=d,t[5]=o*u,t[9]=-a*u,t[2]=-c*u,t[6]=f*d+_,t[10]=h-v*d}else if(e.order==="XZY"){const h=o*l,f=o*c,_=a*l,v=a*c;t[0]=l*u,t[4]=-d,t[8]=c*u,t[1]=h*d+v,t[5]=o*u,t[9]=f*d-_,t[2]=_*d-f,t[6]=a*u,t[10]=v*d+h}return t[3]=0,t[7]=0,t[11]=0,t[12]=0,t[13]=0,t[14]=0,t[15]=1,this}makeRotationFromQuaternion(e){return this.compose(S0,e,M0)}lookAt(e,t,i){const r=this.elements;return Cn.subVectors(e,t),Cn.lengthSq()===0&&(Cn.z=1),Cn.normalize(),Hi.crossVectors(i,Cn),Hi.lengthSq()===0&&(Math.abs(i.z)===1?Cn.x+=1e-4:Cn.z+=1e-4,Cn.normalize(),Hi.crossVectors(i,Cn)),Hi.normalize(),Oo.crossVectors(Cn,Hi),r[0]=Hi.x,r[4]=Oo.x,r[8]=Cn.x,r[1]=Hi.y,r[5]=Oo.y,r[9]=Cn.y,r[2]=Hi.z,r[6]=Oo.z,r[10]=Cn.z,this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,t){const i=e.elements,r=t.elements,s=this.elements,o=i[0],a=i[4],l=i[8],c=i[12],u=i[1],d=i[5],h=i[9],f=i[13],_=i[2],v=i[6],g=i[10],m=i[14],y=i[3],S=i[7],M=i[11],R=i[15],A=r[0],C=r[4],D=r[8],$=r[12],b=r[1],E=r[5],F=r[9],O=r[13],X=r[2],re=r[6],K=r[10],he=r[14],j=r[3],Ee=r[7],_e=r[11],Se=r[15];return s[0]=o*A+a*b+l*X+c*j,s[4]=o*C+a*E+l*re+c*Ee,s[8]=o*D+a*F+l*K+c*_e,s[12]=o*$+a*O+l*he+c*Se,s[1]=u*A+d*b+h*X+f*j,s[5]=u*C+d*E+h*re+f*Ee,s[9]=u*D+d*F+h*K+f*_e,s[13]=u*$+d*O+h*he+f*Se,s[2]=_*A+v*b+g*X+m*j,s[6]=_*C+v*E+g*re+m*Ee,s[10]=_*D+v*F+g*K+m*_e,s[14]=_*$+v*O+g*he+m*Se,s[3]=y*A+S*b+M*X+R*j,s[7]=y*C+S*E+M*re+R*Ee,s[11]=y*D+S*F+M*K+R*_e,s[15]=y*$+S*O+M*he+R*Se,this}multiplyScalar(e){const t=this.elements;return t[0]*=e,t[4]*=e,t[8]*=e,t[12]*=e,t[1]*=e,t[5]*=e,t[9]*=e,t[13]*=e,t[2]*=e,t[6]*=e,t[10]*=e,t[14]*=e,t[3]*=e,t[7]*=e,t[11]*=e,t[15]*=e,this}determinant(){const e=this.elements,t=e[0],i=e[4],r=e[8],s=e[12],o=e[1],a=e[5],l=e[9],c=e[13],u=e[2],d=e[6],h=e[10],f=e[14],_=e[3],v=e[7],g=e[11],m=e[15];return _*(+s*l*d-r*c*d-s*a*h+i*c*h+r*a*f-i*l*f)+v*(+t*l*f-t*c*h+s*o*h-r*o*f+r*c*u-s*l*u)+g*(+t*c*d-t*a*f-s*o*d+i*o*f+s*a*u-i*c*u)+m*(-r*a*u-t*l*d+t*a*h+r*o*d-i*o*h+i*l*u)}transpose(){const e=this.elements;let t;return t=e[1],e[1]=e[4],e[4]=t,t=e[2],e[2]=e[8],e[8]=t,t=e[6],e[6]=e[9],e[9]=t,t=e[3],e[3]=e[12],e[12]=t,t=e[7],e[7]=e[13],e[13]=t,t=e[11],e[11]=e[14],e[14]=t,this}setPosition(e,t,i){const r=this.elements;return e.isVector3?(r[12]=e.x,r[13]=e.y,r[14]=e.z):(r[12]=e,r[13]=t,r[14]=i),this}invert(){const e=this.elements,t=e[0],i=e[1],r=e[2],s=e[3],o=e[4],a=e[5],l=e[6],c=e[7],u=e[8],d=e[9],h=e[10],f=e[11],_=e[12],v=e[13],g=e[14],m=e[15],y=d*g*c-v*h*c+v*l*f-a*g*f-d*l*m+a*h*m,S=_*h*c-u*g*c-_*l*f+o*g*f+u*l*m-o*h*m,M=u*v*c-_*d*c+_*a*f-o*v*f-u*a*m+o*d*m,R=_*d*l-u*v*l-_*a*h+o*v*h+u*a*g-o*d*g,A=t*y+i*S+r*M+s*R;if(A===0)return this.set(0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0);const C=1/A;return e[0]=y*C,e[1]=(v*h*s-d*g*s-v*r*f+i*g*f+d*r*m-i*h*m)*C,e[2]=(a*g*s-v*l*s+v*r*c-i*g*c-a*r*m+i*l*m)*C,e[3]=(d*l*s-a*h*s-d*r*c+i*h*c+a*r*f-i*l*f)*C,e[4]=S*C,e[5]=(u*g*s-_*h*s+_*r*f-t*g*f-u*r*m+t*h*m)*C,e[6]=(_*l*s-o*g*s-_*r*c+t*g*c+o*r*m-t*l*m)*C,e[7]=(o*h*s-u*l*s+u*r*c-t*h*c-o*r*f+t*l*f)*C,e[8]=M*C,e[9]=(_*d*s-u*v*s-_*i*f+t*v*f+u*i*m-t*d*m)*C,e[10]=(o*v*s-_*a*s+_*i*c-t*v*c-o*i*m+t*a*m)*C,e[11]=(u*a*s-o*d*s-u*i*c+t*d*c+o*i*f-t*a*f)*C,e[12]=R*C,e[13]=(u*v*r-_*d*r+_*i*h-t*v*h-u*i*g+t*d*g)*C,e[14]=(_*a*r-o*v*r-_*i*l+t*v*l+o*i*g-t*a*g)*C,e[15]=(o*d*r-u*a*r+u*i*l-t*d*l-o*i*h+t*a*h)*C,this}scale(e){const t=this.elements,i=e.x,r=e.y,s=e.z;return t[0]*=i,t[4]*=r,t[8]*=s,t[1]*=i,t[5]*=r,t[9]*=s,t[2]*=i,t[6]*=r,t[10]*=s,t[3]*=i,t[7]*=r,t[11]*=s,this}getMaxScaleOnAxis(){const e=this.elements,t=e[0]*e[0]+e[1]*e[1]+e[2]*e[2],i=e[4]*e[4]+e[5]*e[5]+e[6]*e[6],r=e[8]*e[8]+e[9]*e[9]+e[10]*e[10];return Math.sqrt(Math.max(t,i,r))}makeTranslation(e,t,i){return e.isVector3?this.set(1,0,0,e.x,0,1,0,e.y,0,0,1,e.z,0,0,0,1):this.set(1,0,0,e,0,1,0,t,0,0,1,i,0,0,0,1),this}makeRotationX(e){const t=Math.cos(e),i=Math.sin(e);return this.set(1,0,0,0,0,t,-i,0,0,i,t,0,0,0,0,1),this}makeRotationY(e){const t=Math.cos(e),i=Math.sin(e);return this.set(t,0,i,0,0,1,0,0,-i,0,t,0,0,0,0,1),this}makeRotationZ(e){const t=Math.cos(e),i=Math.sin(e);return this.set(t,-i,0,0,i,t,0,0,0,0,1,0,0,0,0,1),this}makeRotationAxis(e,t){const i=Math.cos(t),r=Math.sin(t),s=1-i,o=e.x,a=e.y,l=e.z,c=s*o,u=s*a;return this.set(c*o+i,c*a-r*l,c*l+r*a,0,c*a+r*l,u*a+i,u*l-r*o,0,c*l-r*a,u*l+r*o,s*l*l+i,0,0,0,0,1),this}makeScale(e,t,i){return this.set(e,0,0,0,0,t,0,0,0,0,i,0,0,0,0,1),this}makeShear(e,t,i,r,s,o){return this.set(1,i,s,0,e,1,o,0,t,r,1,0,0,0,0,1),this}compose(e,t,i){const r=this.elements,s=t._x,o=t._y,a=t._z,l=t._w,c=s+s,u=o+o,d=a+a,h=s*c,f=s*u,_=s*d,v=o*u,g=o*d,m=a*d,y=l*c,S=l*u,M=l*d,R=i.x,A=i.y,C=i.z;return r[0]=(1-(v+m))*R,r[1]=(f+M)*R,r[2]=(_-S)*R,r[3]=0,r[4]=(f-M)*A,r[5]=(1-(h+m))*A,r[6]=(g+y)*A,r[7]=0,r[8]=(_+S)*C,r[9]=(g-y)*C,r[10]=(1-(h+v))*C,r[11]=0,r[12]=e.x,r[13]=e.y,r[14]=e.z,r[15]=1,this}decompose(e,t,i){const r=this.elements;let s=Hr.set(r[0],r[1],r[2]).length();const o=Hr.set(r[4],r[5],r[6]).length(),a=Hr.set(r[8],r[9],r[10]).length();this.determinant()<0&&(s=-s),e.x=r[12],e.y=r[13],e.z=r[14],Yn.copy(this);const c=1/s,u=1/o,d=1/a;return Yn.elements[0]*=c,Yn.elements[1]*=c,Yn.elements[2]*=c,Yn.elements[4]*=u,Yn.elements[5]*=u,Yn.elements[6]*=u,Yn.elements[8]*=d,Yn.elements[9]*=d,Yn.elements[10]*=d,t.setFromRotationMatrix(Yn),i.x=s,i.y=o,i.z=a,this}makePerspective(e,t,i,r,s,o,a=Ci){const l=this.elements,c=2*s/(t-e),u=2*s/(i-r),d=(t+e)/(t-e),h=(i+r)/(i-r);let f,_;if(a===Ci)f=-(o+s)/(o-s),_=-2*o*s/(o-s);else if(a===Fa)f=-o/(o-s),_=-o*s/(o-s);else throw new Error("THREE.Matrix4.makePerspective(): Invalid coordinate system: "+a);return l[0]=c,l[4]=0,l[8]=d,l[12]=0,l[1]=0,l[5]=u,l[9]=h,l[13]=0,l[2]=0,l[6]=0,l[10]=f,l[14]=_,l[3]=0,l[7]=0,l[11]=-1,l[15]=0,this}makeOrthographic(e,t,i,r,s,o,a=Ci){const l=this.elements,c=1/(t-e),u=1/(i-r),d=1/(o-s),h=(t+e)*c,f=(i+r)*u;let _,v;if(a===Ci)_=(o+s)*d,v=-2*d;else if(a===Fa)_=s*d,v=-1*d;else throw new Error("THREE.Matrix4.makeOrthographic(): Invalid coordinate system: "+a);return l[0]=2*c,l[4]=0,l[8]=0,l[12]=-h,l[1]=0,l[5]=2*u,l[9]=0,l[13]=-f,l[2]=0,l[6]=0,l[10]=v,l[14]=-_,l[3]=0,l[7]=0,l[11]=0,l[15]=1,this}equals(e){const t=this.elements,i=e.elements;for(let r=0;r<16;r++)if(t[r]!==i[r])return!1;return!0}fromArray(e,t=0){for(let i=0;i<16;i++)this.elements[i]=e[i+t];return this}toArray(e=[],t=0){const i=this.elements;return e[t]=i[0],e[t+1]=i[1],e[t+2]=i[2],e[t+3]=i[3],e[t+4]=i[4],e[t+5]=i[5],e[t+6]=i[6],e[t+7]=i[7],e[t+8]=i[8],e[t+9]=i[9],e[t+10]=i[10],e[t+11]=i[11],e[t+12]=i[12],e[t+13]=i[13],e[t+14]=i[14],e[t+15]=i[15],e}}const Hr=new z,Yn=new ht,S0=new z(0,0,0),M0=new z(1,1,1),Hi=new z,Oo=new z,Cn=new z,Vd=new ht,Gd=new wr;class ui{constructor(e=0,t=0,i=0,r=ui.DEFAULT_ORDER){this.isEuler=!0,this._x=e,this._y=t,this._z=i,this._order=r}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get order(){return this._order}set order(e){this._order=e,this._onChangeCallback()}set(e,t,i,r=this._order){return this._x=e,this._y=t,this._z=i,this._order=r,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._order)}copy(e){return this._x=e._x,this._y=e._y,this._z=e._z,this._order=e._order,this._onChangeCallback(),this}setFromRotationMatrix(e,t=this._order,i=!0){const r=e.elements,s=r[0],o=r[4],a=r[8],l=r[1],c=r[5],u=r[9],d=r[2],h=r[6],f=r[10];switch(t){case"XYZ":this._y=Math.asin(Qt(a,-1,1)),Math.abs(a)<.9999999?(this._x=Math.atan2(-u,f),this._z=Math.atan2(-o,s)):(this._x=Math.atan2(h,c),this._z=0);break;case"YXZ":this._x=Math.asin(-Qt(u,-1,1)),Math.abs(u)<.9999999?(this._y=Math.atan2(a,f),this._z=Math.atan2(l,c)):(this._y=Math.atan2(-d,s),this._z=0);break;case"ZXY":this._x=Math.asin(Qt(h,-1,1)),Math.abs(h)<.9999999?(this._y=Math.atan2(-d,f),this._z=Math.atan2(-o,c)):(this._y=0,this._z=Math.atan2(l,s));break;case"ZYX":this._y=Math.asin(-Qt(d,-1,1)),Math.abs(d)<.9999999?(this._x=Math.atan2(h,f),this._z=Math.atan2(l,s)):(this._x=0,this._z=Math.atan2(-o,c));break;case"YZX":this._z=Math.asin(Qt(l,-1,1)),Math.abs(l)<.9999999?(this._x=Math.atan2(-u,c),this._y=Math.atan2(-d,s)):(this._x=0,this._y=Math.atan2(a,f));break;case"XZY":this._z=Math.asin(-Qt(o,-1,1)),Math.abs(o)<.9999999?(this._x=Math.atan2(h,c),this._y=Math.atan2(a,s)):(this._x=Math.atan2(-u,f),this._y=0);break;default:console.warn("THREE.Euler: .setFromRotationMatrix() encountered an unknown order: "+t)}return this._order=t,i===!0&&this._onChangeCallback(),this}setFromQuaternion(e,t,i){return Vd.makeRotationFromQuaternion(e),this.setFromRotationMatrix(Vd,t,i)}setFromVector3(e,t=this._order){return this.set(e.x,e.y,e.z,t)}reorder(e){return Gd.setFromEuler(this),this.setFromQuaternion(Gd,e)}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._order===this._order}fromArray(e){return this._x=e[0],this._y=e[1],this._z=e[2],e[3]!==void 0&&(this._order=e[3]),this._onChangeCallback(),this}toArray(e=[],t=0){return e[t]=this._x,e[t+1]=this._y,e[t+2]=this._z,e[t+3]=this._order,e}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._order}}ui.DEFAULT_ORDER="XYZ";class Ru{constructor(){this.mask=1}set(e){this.mask=(1<<e|0)>>>0}enable(e){this.mask|=1<<e|0}enableAll(){this.mask=-1}toggle(e){this.mask^=1<<e|0}disable(e){this.mask&=~(1<<e|0)}disableAll(){this.mask=0}test(e){return(this.mask&e.mask)!==0}isEnabled(e){return(this.mask&(1<<e|0))!==0}}let w0=0;const Wd=new z,Vr=new wr,vi=new ht,Bo=new z,Hs=new z,E0=new z,T0=new wr,$d=new z(1,0,0),Xd=new z(0,1,0),jd=new z(0,0,1),qd={type:"added"},A0={type:"removed"},Gr={type:"childadded",child:null},El={type:"childremoved",child:null};class Jt extends Er{constructor(){super(),this.isObject3D=!0,Object.defineProperty(this,"id",{value:w0++}),this.uuid=Ts(),this.name="",this.type="Object3D",this.parent=null,this.children=[],this.up=Jt.DEFAULT_UP.clone();const e=new z,t=new ui,i=new wr,r=new z(1,1,1);function s(){i.setFromEuler(t,!1)}function o(){t.setFromQuaternion(i,void 0,!1)}t._onChange(s),i._onChange(o),Object.defineProperties(this,{position:{configurable:!0,enumerable:!0,value:e},rotation:{configurable:!0,enumerable:!0,value:t},quaternion:{configurable:!0,enumerable:!0,value:i},scale:{configurable:!0,enumerable:!0,value:r},modelViewMatrix:{value:new ht},normalMatrix:{value:new rt}}),this.matrix=new ht,this.matrixWorld=new ht,this.matrixAutoUpdate=Jt.DEFAULT_MATRIX_AUTO_UPDATE,this.matrixWorldAutoUpdate=Jt.DEFAULT_MATRIX_WORLD_AUTO_UPDATE,this.matrixWorldNeedsUpdate=!1,this.layers=new Ru,this.visible=!0,this.castShadow=!1,this.receiveShadow=!1,this.frustumCulled=!0,this.renderOrder=0,this.animations=[],this.userData={}}onBeforeShadow(){}onAfterShadow(){}onBeforeRender(){}onAfterRender(){}applyMatrix4(e){this.matrixAutoUpdate&&this.updateMatrix(),this.matrix.premultiply(e),this.matrix.decompose(this.position,this.quaternion,this.scale)}applyQuaternion(e){return this.quaternion.premultiply(e),this}setRotationFromAxisAngle(e,t){this.quaternion.setFromAxisAngle(e,t)}setRotationFromEuler(e){this.quaternion.setFromEuler(e,!0)}setRotationFromMatrix(e){this.quaternion.setFromRotationMatrix(e)}setRotationFromQuaternion(e){this.quaternion.copy(e)}rotateOnAxis(e,t){return Vr.setFromAxisAngle(e,t),this.quaternion.multiply(Vr),this}rotateOnWorldAxis(e,t){return Vr.setFromAxisAngle(e,t),this.quaternion.premultiply(Vr),this}rotateX(e){return this.rotateOnAxis($d,e)}rotateY(e){return this.rotateOnAxis(Xd,e)}rotateZ(e){return this.rotateOnAxis(jd,e)}translateOnAxis(e,t){return Wd.copy(e).applyQuaternion(this.quaternion),this.position.add(Wd.multiplyScalar(t)),this}translateX(e){return this.translateOnAxis($d,e)}translateY(e){return this.translateOnAxis(Xd,e)}translateZ(e){return this.translateOnAxis(jd,e)}localToWorld(e){return this.updateWorldMatrix(!0,!1),e.applyMatrix4(this.matrixWorld)}worldToLocal(e){return this.updateWorldMatrix(!0,!1),e.applyMatrix4(vi.copy(this.matrixWorld).invert())}lookAt(e,t,i){e.isVector3?Bo.copy(e):Bo.set(e,t,i);const r=this.parent;this.updateWorldMatrix(!0,!1),Hs.setFromMatrixPosition(this.matrixWorld),this.isCamera||this.isLight?vi.lookAt(Hs,Bo,this.up):vi.lookAt(Bo,Hs,this.up),this.quaternion.setFromRotationMatrix(vi),r&&(vi.extractRotation(r.matrixWorld),Vr.setFromRotationMatrix(vi),this.quaternion.premultiply(Vr.invert()))}add(e){if(arguments.length>1){for(let t=0;t<arguments.length;t++)this.add(arguments[t]);return this}return e===this?(console.error("THREE.Object3D.add: object can't be added as a child of itself.",e),this):(e&&e.isObject3D?(e.removeFromParent(),e.parent=this,this.children.push(e),e.dispatchEvent(qd),Gr.child=e,this.dispatchEvent(Gr),Gr.child=null):console.error("THREE.Object3D.add: object not an instance of THREE.Object3D.",e),this)}remove(e){if(arguments.length>1){for(let i=0;i<arguments.length;i++)this.remove(arguments[i]);return this}const t=this.children.indexOf(e);return t!==-1&&(e.parent=null,this.children.splice(t,1),e.dispatchEvent(A0),El.child=e,this.dispatchEvent(El),El.child=null),this}removeFromParent(){const e=this.parent;return e!==null&&e.remove(this),this}clear(){return this.remove(...this.children)}attach(e){return this.updateWorldMatrix(!0,!1),vi.copy(this.matrixWorld).invert(),e.parent!==null&&(e.parent.updateWorldMatrix(!0,!1),vi.multiply(e.parent.matrixWorld)),e.applyMatrix4(vi),e.removeFromParent(),e.parent=this,this.children.push(e),e.updateWorldMatrix(!1,!0),e.dispatchEvent(qd),Gr.child=e,this.dispatchEvent(Gr),Gr.child=null,this}getObjectById(e){return this.getObjectByProperty("id",e)}getObjectByName(e){return this.getObjectByProperty("name",e)}getObjectByProperty(e,t){if(this[e]===t)return this;for(let i=0,r=this.children.length;i<r;i++){const o=this.children[i].getObjectByProperty(e,t);if(o!==void 0)return o}}getObjectsByProperty(e,t,i=[]){this[e]===t&&i.push(this);const r=this.children;for(let s=0,o=r.length;s<o;s++)r[s].getObjectsByProperty(e,t,i);return i}getWorldPosition(e){return this.updateWorldMatrix(!0,!1),e.setFromMatrixPosition(this.matrixWorld)}getWorldQuaternion(e){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(Hs,e,E0),e}getWorldScale(e){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(Hs,T0,e),e}getWorldDirection(e){this.updateWorldMatrix(!0,!1);const t=this.matrixWorld.elements;return e.set(t[8],t[9],t[10]).normalize()}raycast(){}traverse(e){e(this);const t=this.children;for(let i=0,r=t.length;i<r;i++)t[i].traverse(e)}traverseVisible(e){if(this.visible===!1)return;e(this);const t=this.children;for(let i=0,r=t.length;i<r;i++)t[i].traverseVisible(e)}traverseAncestors(e){const t=this.parent;t!==null&&(e(t),t.traverseAncestors(e))}updateMatrix(){this.matrix.compose(this.position,this.quaternion,this.scale),this.matrixWorldNeedsUpdate=!0}updateMatrixWorld(e){this.matrixAutoUpdate&&this.updateMatrix(),(this.matrixWorldNeedsUpdate||e)&&(this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),this.matrixWorldNeedsUpdate=!1,e=!0);const t=this.children;for(let i=0,r=t.length;i<r;i++)t[i].updateMatrixWorld(e)}updateWorldMatrix(e,t){const i=this.parent;if(e===!0&&i!==null&&i.updateWorldMatrix(!0,!1),this.matrixAutoUpdate&&this.updateMatrix(),this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),t===!0){const r=this.children;for(let s=0,o=r.length;s<o;s++)r[s].updateWorldMatrix(!1,!0)}}toJSON(e){const t=e===void 0||typeof e=="string",i={};t&&(e={geometries:{},materials:{},textures:{},images:{},shapes:{},skeletons:{},animations:{},nodes:{}},i.metadata={version:4.6,type:"Object",generator:"Object3D.toJSON"});const r={};r.uuid=this.uuid,r.type=this.type,this.name!==""&&(r.name=this.name),this.castShadow===!0&&(r.castShadow=!0),this.receiveShadow===!0&&(r.receiveShadow=!0),this.visible===!1&&(r.visible=!1),this.frustumCulled===!1&&(r.frustumCulled=!1),this.renderOrder!==0&&(r.renderOrder=this.renderOrder),Object.keys(this.userData).length>0&&(r.userData=this.userData),r.layers=this.layers.mask,r.matrix=this.matrix.toArray(),r.up=this.up.toArray(),this.matrixAutoUpdate===!1&&(r.matrixAutoUpdate=!1),this.isInstancedMesh&&(r.type="InstancedMesh",r.count=this.count,r.instanceMatrix=this.instanceMatrix.toJSON(),this.instanceColor!==null&&(r.instanceColor=this.instanceColor.toJSON())),this.isBatchedMesh&&(r.type="BatchedMesh",r.perObjectFrustumCulled=this.perObjectFrustumCulled,r.sortObjects=this.sortObjects,r.drawRanges=this._drawRanges,r.reservedRanges=this._reservedRanges,r.visibility=this._visibility,r.active=this._active,r.bounds=this._bounds.map(a=>({boxInitialized:a.boxInitialized,boxMin:a.box.min.toArray(),boxMax:a.box.max.toArray(),sphereInitialized:a.sphereInitialized,sphereRadius:a.sphere.radius,sphereCenter:a.sphere.center.toArray()})),r.maxInstanceCount=this._maxInstanceCount,r.maxVertexCount=this._maxVertexCount,r.maxIndexCount=this._maxIndexCount,r.geometryInitialized=this._geometryInitialized,r.geometryCount=this._geometryCount,r.matricesTexture=this._matricesTexture.toJSON(e),this._colorsTexture!==null&&(r.colorsTexture=this._colorsTexture.toJSON(e)),this.boundingSphere!==null&&(r.boundingSphere={center:r.boundingSphere.center.toArray(),radius:r.boundingSphere.radius}),this.boundingBox!==null&&(r.boundingBox={min:r.boundingBox.min.toArray(),max:r.boundingBox.max.toArray()}));function s(a,l){return a[l.uuid]===void 0&&(a[l.uuid]=l.toJSON(e)),l.uuid}if(this.isScene)this.background&&(this.background.isColor?r.background=this.background.toJSON():this.background.isTexture&&(r.background=this.background.toJSON(e).uuid)),this.environment&&this.environment.isTexture&&this.environment.isRenderTargetTexture!==!0&&(r.environment=this.environment.toJSON(e).uuid);else if(this.isMesh||this.isLine||this.isPoints){r.geometry=s(e.geometries,this.geometry);const a=this.geometry.parameters;if(a!==void 0&&a.shapes!==void 0){const l=a.shapes;if(Array.isArray(l))for(let c=0,u=l.length;c<u;c++){const d=l[c];s(e.shapes,d)}else s(e.shapes,l)}}if(this.isSkinnedMesh&&(r.bindMode=this.bindMode,r.bindMatrix=this.bindMatrix.toArray(),this.skeleton!==void 0&&(s(e.skeletons,this.skeleton),r.skeleton=this.skeleton.uuid)),this.material!==void 0)if(Array.isArray(this.material)){const a=[];for(let l=0,c=this.material.length;l<c;l++)a.push(s(e.materials,this.material[l]));r.material=a}else r.material=s(e.materials,this.material);if(this.children.length>0){r.children=[];for(let a=0;a<this.children.length;a++)r.children.push(this.children[a].toJSON(e).object)}if(this.animations.length>0){r.animations=[];for(let a=0;a<this.animations.length;a++){const l=this.animations[a];r.animations.push(s(e.animations,l))}}if(t){const a=o(e.geometries),l=o(e.materials),c=o(e.textures),u=o(e.images),d=o(e.shapes),h=o(e.skeletons),f=o(e.animations),_=o(e.nodes);a.length>0&&(i.geometries=a),l.length>0&&(i.materials=l),c.length>0&&(i.textures=c),u.length>0&&(i.images=u),d.length>0&&(i.shapes=d),h.length>0&&(i.skeletons=h),f.length>0&&(i.animations=f),_.length>0&&(i.nodes=_)}return i.object=r,i;function o(a){const l=[];for(const c in a){const u=a[c];delete u.metadata,l.push(u)}return l}}clone(e){return new this.constructor().copy(this,e)}copy(e,t=!0){if(this.name=e.name,this.up.copy(e.up),this.position.copy(e.position),this.rotation.order=e.rotation.order,this.quaternion.copy(e.quaternion),this.scale.copy(e.scale),this.matrix.copy(e.matrix),this.matrixWorld.copy(e.matrixWorld),this.matrixAutoUpdate=e.matrixAutoUpdate,this.matrixWorldAutoUpdate=e.matrixWorldAutoUpdate,this.matrixWorldNeedsUpdate=e.matrixWorldNeedsUpdate,this.layers.mask=e.layers.mask,this.visible=e.visible,this.castShadow=e.castShadow,this.receiveShadow=e.receiveShadow,this.frustumCulled=e.frustumCulled,this.renderOrder=e.renderOrder,this.animations=e.animations.slice(),this.userData=JSON.parse(JSON.stringify(e.userData)),t===!0)for(let i=0;i<e.children.length;i++){const r=e.children[i];this.add(r.clone())}return this}}Jt.DEFAULT_UP=new z(0,1,0);Jt.DEFAULT_MATRIX_AUTO_UPDATE=!0;Jt.DEFAULT_MATRIX_WORLD_AUTO_UPDATE=!0;const Zn=new z,yi=new z,Tl=new z,xi=new z,Wr=new z,$r=new z,Yd=new z,Al=new z,Cl=new z,Pl=new z,Rl=new Rt,Ll=new Rt,Il=new Rt;class tn{constructor(e=new z,t=new z,i=new z){this.a=e,this.b=t,this.c=i}static getNormal(e,t,i,r){r.subVectors(i,t),Zn.subVectors(e,t),r.cross(Zn);const s=r.lengthSq();return s>0?r.multiplyScalar(1/Math.sqrt(s)):r.set(0,0,0)}static getBarycoord(e,t,i,r,s){Zn.subVectors(r,t),yi.subVectors(i,t),Tl.subVectors(e,t);const o=Zn.dot(Zn),a=Zn.dot(yi),l=Zn.dot(Tl),c=yi.dot(yi),u=yi.dot(Tl),d=o*c-a*a;if(d===0)return s.set(0,0,0),null;const h=1/d,f=(c*l-a*u)*h,_=(o*u-a*l)*h;return s.set(1-f-_,_,f)}static containsPoint(e,t,i,r){return this.getBarycoord(e,t,i,r,xi)===null?!1:xi.x>=0&&xi.y>=0&&xi.x+xi.y<=1}static getInterpolation(e,t,i,r,s,o,a,l){return this.getBarycoord(e,t,i,r,xi)===null?(l.x=0,l.y=0,"z"in l&&(l.z=0),"w"in l&&(l.w=0),null):(l.setScalar(0),l.addScaledVector(s,xi.x),l.addScaledVector(o,xi.y),l.addScaledVector(a,xi.z),l)}static getInterpolatedAttribute(e,t,i,r,s,o){return Rl.setScalar(0),Ll.setScalar(0),Il.setScalar(0),Rl.fromBufferAttribute(e,t),Ll.fromBufferAttribute(e,i),Il.fromBufferAttribute(e,r),o.setScalar(0),o.addScaledVector(Rl,s.x),o.addScaledVector(Ll,s.y),o.addScaledVector(Il,s.z),o}static isFrontFacing(e,t,i,r){return Zn.subVectors(i,t),yi.subVectors(e,t),Zn.cross(yi).dot(r)<0}set(e,t,i){return this.a.copy(e),this.b.copy(t),this.c.copy(i),this}setFromPointsAndIndices(e,t,i,r){return this.a.copy(e[t]),this.b.copy(e[i]),this.c.copy(e[r]),this}setFromAttributeAndIndices(e,t,i,r){return this.a.fromBufferAttribute(e,t),this.b.fromBufferAttribute(e,i),this.c.fromBufferAttribute(e,r),this}clone(){return new this.constructor().copy(this)}copy(e){return this.a.copy(e.a),this.b.copy(e.b),this.c.copy(e.c),this}getArea(){return Zn.subVectors(this.c,this.b),yi.subVectors(this.a,this.b),Zn.cross(yi).length()*.5}getMidpoint(e){return e.addVectors(this.a,this.b).add(this.c).multiplyScalar(1/3)}getNormal(e){return tn.getNormal(this.a,this.b,this.c,e)}getPlane(e){return e.setFromCoplanarPoints(this.a,this.b,this.c)}getBarycoord(e,t){return tn.getBarycoord(e,this.a,this.b,this.c,t)}getInterpolation(e,t,i,r,s){return tn.getInterpolation(e,this.a,this.b,this.c,t,i,r,s)}containsPoint(e){return tn.containsPoint(e,this.a,this.b,this.c)}isFrontFacing(e){return tn.isFrontFacing(this.a,this.b,this.c,e)}intersectsBox(e){return e.intersectsTriangle(this)}closestPointToPoint(e,t){const i=this.a,r=this.b,s=this.c;let o,a;Wr.subVectors(r,i),$r.subVectors(s,i),Al.subVectors(e,i);const l=Wr.dot(Al),c=$r.dot(Al);if(l<=0&&c<=0)return t.copy(i);Cl.subVectors(e,r);const u=Wr.dot(Cl),d=$r.dot(Cl);if(u>=0&&d<=u)return t.copy(r);const h=l*d-u*c;if(h<=0&&l>=0&&u<=0)return o=l/(l-u),t.copy(i).addScaledVector(Wr,o);Pl.subVectors(e,s);const f=Wr.dot(Pl),_=$r.dot(Pl);if(_>=0&&f<=_)return t.copy(s);const v=f*c-l*_;if(v<=0&&c>=0&&_<=0)return a=c/(c-_),t.copy(i).addScaledVector($r,a);const g=u*_-f*d;if(g<=0&&d-u>=0&&f-_>=0)return Yd.subVectors(s,r),a=(d-u)/(d-u+(f-_)),t.copy(r).addScaledVector(Yd,a);const m=1/(g+v+h);return o=v*m,a=h*m,t.copy(i).addScaledVector(Wr,o).addScaledVector($r,a)}equals(e){return e.a.equals(this.a)&&e.b.equals(this.b)&&e.c.equals(this.c)}}const ap={aliceblue:15792383,antiquewhite:16444375,aqua:65535,aquamarine:8388564,azure:15794175,beige:16119260,bisque:16770244,black:0,blanchedalmond:16772045,blue:255,blueviolet:9055202,brown:10824234,burlywood:14596231,cadetblue:6266528,chartreuse:8388352,chocolate:13789470,coral:16744272,cornflowerblue:6591981,cornsilk:16775388,crimson:14423100,cyan:65535,darkblue:139,darkcyan:35723,darkgoldenrod:12092939,darkgray:11119017,darkgreen:25600,darkgrey:11119017,darkkhaki:12433259,darkmagenta:9109643,darkolivegreen:5597999,darkorange:16747520,darkorchid:10040012,darkred:9109504,darksalmon:15308410,darkseagreen:9419919,darkslateblue:4734347,darkslategray:3100495,darkslategrey:3100495,darkturquoise:52945,darkviolet:9699539,deeppink:16716947,deepskyblue:49151,dimgray:6908265,dimgrey:6908265,dodgerblue:2003199,firebrick:11674146,floralwhite:16775920,forestgreen:2263842,fuchsia:16711935,gainsboro:14474460,ghostwhite:16316671,gold:16766720,goldenrod:14329120,gray:8421504,green:32768,greenyellow:11403055,grey:8421504,honeydew:15794160,hotpink:16738740,indianred:13458524,indigo:4915330,ivory:16777200,khaki:15787660,lavender:15132410,lavenderblush:16773365,lawngreen:8190976,lemonchiffon:16775885,lightblue:11393254,lightcoral:15761536,lightcyan:14745599,lightgoldenrodyellow:16448210,lightgray:13882323,lightgreen:9498256,lightgrey:13882323,lightpink:16758465,lightsalmon:16752762,lightseagreen:2142890,lightskyblue:8900346,lightslategray:7833753,lightslategrey:7833753,lightsteelblue:11584734,lightyellow:16777184,lime:65280,limegreen:3329330,linen:16445670,magenta:16711935,maroon:8388608,mediumaquamarine:6737322,mediumblue:205,mediumorchid:12211667,mediumpurple:9662683,mediumseagreen:3978097,mediumslateblue:8087790,mediumspringgreen:64154,mediumturquoise:4772300,mediumvioletred:13047173,midnightblue:1644912,mintcream:16121850,mistyrose:16770273,moccasin:16770229,navajowhite:16768685,navy:128,oldlace:16643558,olive:8421376,olivedrab:7048739,orange:16753920,orangered:16729344,orchid:14315734,palegoldenrod:15657130,palegreen:10025880,paleturquoise:11529966,palevioletred:14381203,papayawhip:16773077,peachpuff:16767673,peru:13468991,pink:16761035,plum:14524637,powderblue:11591910,purple:8388736,rebeccapurple:6697881,red:16711680,rosybrown:12357519,royalblue:4286945,saddlebrown:9127187,salmon:16416882,sandybrown:16032864,seagreen:3050327,seashell:16774638,sienna:10506797,silver:12632256,skyblue:8900331,slateblue:6970061,slategray:7372944,slategrey:7372944,snow:16775930,springgreen:65407,steelblue:4620980,tan:13808780,teal:32896,thistle:14204888,tomato:16737095,turquoise:4251856,violet:15631086,wheat:16113331,white:16777215,whitesmoke:16119285,yellow:16776960,yellowgreen:10145074},Vi={h:0,s:0,l:0},ko={h:0,s:0,l:0};function Dl(n,e,t){return t<0&&(t+=1),t>1&&(t-=1),t<1/6?n+(e-n)*6*t:t<1/2?e:t<2/3?n+(e-n)*6*(2/3-t):n}class Ke{constructor(e,t,i){return this.isColor=!0,this.r=1,this.g=1,this.b=1,this.set(e,t,i)}set(e,t,i){if(t===void 0&&i===void 0){const r=e;r&&r.isColor?this.copy(r):typeof r=="number"?this.setHex(r):typeof r=="string"&&this.setStyle(r)}else this.setRGB(e,t,i);return this}setScalar(e){return this.r=e,this.g=e,this.b=e,this}setHex(e,t=Ln){return e=Math.floor(e),this.r=(e>>16&255)/255,this.g=(e>>8&255)/255,this.b=(e&255)/255,ft.toWorkingColorSpace(this,t),this}setRGB(e,t,i,r=ft.workingColorSpace){return this.r=e,this.g=t,this.b=i,ft.toWorkingColorSpace(this,r),this}setHSL(e,t,i,r=ft.workingColorSpace){if(e=Cu(e,1),t=Qt(t,0,1),i=Qt(i,0,1),t===0)this.r=this.g=this.b=i;else{const s=i<=.5?i*(1+t):i+t-i*t,o=2*i-s;this.r=Dl(o,s,e+1/3),this.g=Dl(o,s,e),this.b=Dl(o,s,e-1/3)}return ft.toWorkingColorSpace(this,r),this}setStyle(e,t=Ln){function i(s){s!==void 0&&parseFloat(s)<1&&console.warn("THREE.Color: Alpha component of "+e+" will be ignored.")}let r;if(r=/^(\w+)\(([^\)]*)\)/.exec(e)){let s;const o=r[1],a=r[2];switch(o){case"rgb":case"rgba":if(s=/^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(a))return i(s[4]),this.setRGB(Math.min(255,parseInt(s[1],10))/255,Math.min(255,parseInt(s[2],10))/255,Math.min(255,parseInt(s[3],10))/255,t);if(s=/^\s*(\d+)\%\s*,\s*(\d+)\%\s*,\s*(\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(a))return i(s[4]),this.setRGB(Math.min(100,parseInt(s[1],10))/100,Math.min(100,parseInt(s[2],10))/100,Math.min(100,parseInt(s[3],10))/100,t);break;case"hsl":case"hsla":if(s=/^\s*(\d*\.?\d+)\s*,\s*(\d*\.?\d+)\%\s*,\s*(\d*\.?\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(a))return i(s[4]),this.setHSL(parseFloat(s[1])/360,parseFloat(s[2])/100,parseFloat(s[3])/100,t);break;default:console.warn("THREE.Color: Unknown color model "+e)}}else if(r=/^\#([A-Fa-f\d]+)$/.exec(e)){const s=r[1],o=s.length;if(o===3)return this.setRGB(parseInt(s.charAt(0),16)/15,parseInt(s.charAt(1),16)/15,parseInt(s.charAt(2),16)/15,t);if(o===6)return this.setHex(parseInt(s,16),t);console.warn("THREE.Color: Invalid hex color "+e)}else if(e&&e.length>0)return this.setColorName(e,t);return this}setColorName(e,t=Ln){const i=ap[e.toLowerCase()];return i!==void 0?this.setHex(i,t):console.warn("THREE.Color: Unknown color "+e),this}clone(){return new this.constructor(this.r,this.g,this.b)}copy(e){return this.r=e.r,this.g=e.g,this.b=e.b,this}copySRGBToLinear(e){return this.r=vs(e.r),this.g=vs(e.g),this.b=vs(e.b),this}copyLinearToSRGB(e){return this.r=_l(e.r),this.g=_l(e.g),this.b=_l(e.b),this}convertSRGBToLinear(){return this.copySRGBToLinear(this),this}convertLinearToSRGB(){return this.copyLinearToSRGB(this),this}getHex(e=Ln){return ft.fromWorkingColorSpace(an.copy(this),e),Math.round(Qt(an.r*255,0,255))*65536+Math.round(Qt(an.g*255,0,255))*256+Math.round(Qt(an.b*255,0,255))}getHexString(e=Ln){return("000000"+this.getHex(e).toString(16)).slice(-6)}getHSL(e,t=ft.workingColorSpace){ft.fromWorkingColorSpace(an.copy(this),t);const i=an.r,r=an.g,s=an.b,o=Math.max(i,r,s),a=Math.min(i,r,s);let l,c;const u=(a+o)/2;if(a===o)l=0,c=0;else{const d=o-a;switch(c=u<=.5?d/(o+a):d/(2-o-a),o){case i:l=(r-s)/d+(r<s?6:0);break;case r:l=(s-i)/d+2;break;case s:l=(i-r)/d+4;break}l/=6}return e.h=l,e.s=c,e.l=u,e}getRGB(e,t=ft.workingColorSpace){return ft.fromWorkingColorSpace(an.copy(this),t),e.r=an.r,e.g=an.g,e.b=an.b,e}getStyle(e=Ln){ft.fromWorkingColorSpace(an.copy(this),e);const t=an.r,i=an.g,r=an.b;return e!==Ln?`color(${e} ${t.toFixed(3)} ${i.toFixed(3)} ${r.toFixed(3)})`:`rgb(${Math.round(t*255)},${Math.round(i*255)},${Math.round(r*255)})`}offsetHSL(e,t,i){return this.getHSL(Vi),this.setHSL(Vi.h+e,Vi.s+t,Vi.l+i)}add(e){return this.r+=e.r,this.g+=e.g,this.b+=e.b,this}addColors(e,t){return this.r=e.r+t.r,this.g=e.g+t.g,this.b=e.b+t.b,this}addScalar(e){return this.r+=e,this.g+=e,this.b+=e,this}sub(e){return this.r=Math.max(0,this.r-e.r),this.g=Math.max(0,this.g-e.g),this.b=Math.max(0,this.b-e.b),this}multiply(e){return this.r*=e.r,this.g*=e.g,this.b*=e.b,this}multiplyScalar(e){return this.r*=e,this.g*=e,this.b*=e,this}lerp(e,t){return this.r+=(e.r-this.r)*t,this.g+=(e.g-this.g)*t,this.b+=(e.b-this.b)*t,this}lerpColors(e,t,i){return this.r=e.r+(t.r-e.r)*i,this.g=e.g+(t.g-e.g)*i,this.b=e.b+(t.b-e.b)*i,this}lerpHSL(e,t){this.getHSL(Vi),e.getHSL(ko);const i=oo(Vi.h,ko.h,t),r=oo(Vi.s,ko.s,t),s=oo(Vi.l,ko.l,t);return this.setHSL(i,r,s),this}setFromVector3(e){return this.r=e.x,this.g=e.y,this.b=e.z,this}applyMatrix3(e){const t=this.r,i=this.g,r=this.b,s=e.elements;return this.r=s[0]*t+s[3]*i+s[6]*r,this.g=s[1]*t+s[4]*i+s[7]*r,this.b=s[2]*t+s[5]*i+s[8]*r,this}equals(e){return e.r===this.r&&e.g===this.g&&e.b===this.b}fromArray(e,t=0){return this.r=e[t],this.g=e[t+1],this.b=e[t+2],this}toArray(e=[],t=0){return e[t]=this.r,e[t+1]=this.g,e[t+2]=this.b,e}fromBufferAttribute(e,t){return this.r=e.getX(t),this.g=e.getY(t),this.b=e.getZ(t),this}toJSON(){return this.getHex()}*[Symbol.iterator](){yield this.r,yield this.g,yield this.b}}const an=new Ke;Ke.NAMES=ap;let C0=0;class Tr extends Er{constructor(){super(),this.isMaterial=!0,Object.defineProperty(this,"id",{value:C0++}),this.uuid=Ts(),this.name="",this.type="Material",this.blending=gs,this.side=In,this.vertexColors=!1,this.opacity=1,this.transparent=!1,this.alphaHash=!1,this.blendSrc=pc,this.blendDst=mc,this.blendEquation=xr,this.blendSrcAlpha=null,this.blendDstAlpha=null,this.blendEquationAlpha=null,this.blendColor=new Ke(0,0,0),this.blendAlpha=0,this.depthFunc=ys,this.depthTest=!0,this.depthWrite=!0,this.stencilWriteMask=255,this.stencilFunc=Nd,this.stencilRef=0,this.stencilFuncMask=255,this.stencilFail=Fr,this.stencilZFail=Fr,this.stencilZPass=Fr,this.stencilWrite=!1,this.clippingPlanes=null,this.clipIntersection=!1,this.clipShadows=!1,this.shadowSide=null,this.colorWrite=!0,this.precision=null,this.polygonOffset=!1,this.polygonOffsetFactor=0,this.polygonOffsetUnits=0,this.dithering=!1,this.alphaToCoverage=!1,this.premultipliedAlpha=!1,this.forceSinglePass=!1,this.visible=!0,this.toneMapped=!0,this.userData={},this.version=0,this._alphaTest=0}get alphaTest(){return this._alphaTest}set alphaTest(e){this._alphaTest>0!=e>0&&this.version++,this._alphaTest=e}onBeforeRender(){}onBeforeCompile(){}customProgramCacheKey(){return this.onBeforeCompile.toString()}setValues(e){if(e!==void 0)for(const t in e){const i=e[t];if(i===void 0){console.warn(`THREE.Material: parameter '${t}' has value of undefined.`);continue}const r=this[t];if(r===void 0){console.warn(`THREE.Material: '${t}' is not a property of THREE.${this.type}.`);continue}r&&r.isColor?r.set(i):r&&r.isVector3&&i&&i.isVector3?r.copy(i):this[t]=i}}toJSON(e){const t=e===void 0||typeof e=="string";t&&(e={textures:{},images:{}});const i={metadata:{version:4.6,type:"Material",generator:"Material.toJSON"}};i.uuid=this.uuid,i.type=this.type,this.name!==""&&(i.name=this.name),this.color&&this.color.isColor&&(i.color=this.color.getHex()),this.roughness!==void 0&&(i.roughness=this.roughness),this.metalness!==void 0&&(i.metalness=this.metalness),this.sheen!==void 0&&(i.sheen=this.sheen),this.sheenColor&&this.sheenColor.isColor&&(i.sheenColor=this.sheenColor.getHex()),this.sheenRoughness!==void 0&&(i.sheenRoughness=this.sheenRoughness),this.emissive&&this.emissive.isColor&&(i.emissive=this.emissive.getHex()),this.emissiveIntensity!==void 0&&this.emissiveIntensity!==1&&(i.emissiveIntensity=this.emissiveIntensity),this.specular&&this.specular.isColor&&(i.specular=this.specular.getHex()),this.specularIntensity!==void 0&&(i.specularIntensity=this.specularIntensity),this.specularColor&&this.specularColor.isColor&&(i.specularColor=this.specularColor.getHex()),this.shininess!==void 0&&(i.shininess=this.shininess),this.clearcoat!==void 0&&(i.clearcoat=this.clearcoat),this.clearcoatRoughness!==void 0&&(i.clearcoatRoughness=this.clearcoatRoughness),this.clearcoatMap&&this.clearcoatMap.isTexture&&(i.clearcoatMap=this.clearcoatMap.toJSON(e).uuid),this.clearcoatRoughnessMap&&this.clearcoatRoughnessMap.isTexture&&(i.clearcoatRoughnessMap=this.clearcoatRoughnessMap.toJSON(e).uuid),this.clearcoatNormalMap&&this.clearcoatNormalMap.isTexture&&(i.clearcoatNormalMap=this.clearcoatNormalMap.toJSON(e).uuid,i.clearcoatNormalScale=this.clearcoatNormalScale.toArray()),this.dispersion!==void 0&&(i.dispersion=this.dispersion),this.iridescence!==void 0&&(i.iridescence=this.iridescence),this.iridescenceIOR!==void 0&&(i.iridescenceIOR=this.iridescenceIOR),this.iridescenceThicknessRange!==void 0&&(i.iridescenceThicknessRange=this.iridescenceThicknessRange),this.iridescenceMap&&this.iridescenceMap.isTexture&&(i.iridescenceMap=this.iridescenceMap.toJSON(e).uuid),this.iridescenceThicknessMap&&this.iridescenceThicknessMap.isTexture&&(i.iridescenceThicknessMap=this.iridescenceThicknessMap.toJSON(e).uuid),this.anisotropy!==void 0&&(i.anisotropy=this.anisotropy),this.anisotropyRotation!==void 0&&(i.anisotropyRotation=this.anisotropyRotation),this.anisotropyMap&&this.anisotropyMap.isTexture&&(i.anisotropyMap=this.anisotropyMap.toJSON(e).uuid),this.map&&this.map.isTexture&&(i.map=this.map.toJSON(e).uuid),this.matcap&&this.matcap.isTexture&&(i.matcap=this.matcap.toJSON(e).uuid),this.alphaMap&&this.alphaMap.isTexture&&(i.alphaMap=this.alphaMap.toJSON(e).uuid),this.lightMap&&this.lightMap.isTexture&&(i.lightMap=this.lightMap.toJSON(e).uuid,i.lightMapIntensity=this.lightMapIntensity),this.aoMap&&this.aoMap.isTexture&&(i.aoMap=this.aoMap.toJSON(e).uuid,i.aoMapIntensity=this.aoMapIntensity),this.bumpMap&&this.bumpMap.isTexture&&(i.bumpMap=this.bumpMap.toJSON(e).uuid,i.bumpScale=this.bumpScale),this.normalMap&&this.normalMap.isTexture&&(i.normalMap=this.normalMap.toJSON(e).uuid,i.normalMapType=this.normalMapType,i.normalScale=this.normalScale.toArray()),this.displacementMap&&this.displacementMap.isTexture&&(i.displacementMap=this.displacementMap.toJSON(e).uuid,i.displacementScale=this.displacementScale,i.displacementBias=this.displacementBias),this.roughnessMap&&this.roughnessMap.isTexture&&(i.roughnessMap=this.roughnessMap.toJSON(e).uuid),this.metalnessMap&&this.metalnessMap.isTexture&&(i.metalnessMap=this.metalnessMap.toJSON(e).uuid),this.emissiveMap&&this.emissiveMap.isTexture&&(i.emissiveMap=this.emissiveMap.toJSON(e).uuid),this.specularMap&&this.specularMap.isTexture&&(i.specularMap=this.specularMap.toJSON(e).uuid),this.specularIntensityMap&&this.specularIntensityMap.isTexture&&(i.specularIntensityMap=this.specularIntensityMap.toJSON(e).uuid),this.specularColorMap&&this.specularColorMap.isTexture&&(i.specularColorMap=this.specularColorMap.toJSON(e).uuid),this.envMap&&this.envMap.isTexture&&(i.envMap=this.envMap.toJSON(e).uuid,this.combine!==void 0&&(i.combine=this.combine)),this.envMapRotation!==void 0&&(i.envMapRotation=this.envMapRotation.toArray()),this.envMapIntensity!==void 0&&(i.envMapIntensity=this.envMapIntensity),this.reflectivity!==void 0&&(i.reflectivity=this.reflectivity),this.refractionRatio!==void 0&&(i.refractionRatio=this.refractionRatio),this.gradientMap&&this.gradientMap.isTexture&&(i.gradientMap=this.gradientMap.toJSON(e).uuid),this.transmission!==void 0&&(i.transmission=this.transmission),this.transmissionMap&&this.transmissionMap.isTexture&&(i.transmissionMap=this.transmissionMap.toJSON(e).uuid),this.thickness!==void 0&&(i.thickness=this.thickness),this.thicknessMap&&this.thicknessMap.isTexture&&(i.thicknessMap=this.thicknessMap.toJSON(e).uuid),this.attenuationDistance!==void 0&&this.attenuationDistance!==1/0&&(i.attenuationDistance=this.attenuationDistance),this.attenuationColor!==void 0&&(i.attenuationColor=this.attenuationColor.getHex()),this.size!==void 0&&(i.size=this.size),this.shadowSide!==null&&(i.shadowSide=this.shadowSide),this.sizeAttenuation!==void 0&&(i.sizeAttenuation=this.sizeAttenuation),this.blending!==gs&&(i.blending=this.blending),this.side!==In&&(i.side=this.side),this.vertexColors===!0&&(i.vertexColors=!0),this.opacity<1&&(i.opacity=this.opacity),this.transparent===!0&&(i.transparent=!0),this.blendSrc!==pc&&(i.blendSrc=this.blendSrc),this.blendDst!==mc&&(i.blendDst=this.blendDst),this.blendEquation!==xr&&(i.blendEquation=this.blendEquation),this.blendSrcAlpha!==null&&(i.blendSrcAlpha=this.blendSrcAlpha),this.blendDstAlpha!==null&&(i.blendDstAlpha=this.blendDstAlpha),this.blendEquationAlpha!==null&&(i.blendEquationAlpha=this.blendEquationAlpha),this.blendColor&&this.blendColor.isColor&&(i.blendColor=this.blendColor.getHex()),this.blendAlpha!==0&&(i.blendAlpha=this.blendAlpha),this.depthFunc!==ys&&(i.depthFunc=this.depthFunc),this.depthTest===!1&&(i.depthTest=this.depthTest),this.depthWrite===!1&&(i.depthWrite=this.depthWrite),this.colorWrite===!1&&(i.colorWrite=this.colorWrite),this.stencilWriteMask!==255&&(i.stencilWriteMask=this.stencilWriteMask),this.stencilFunc!==Nd&&(i.stencilFunc=this.stencilFunc),this.stencilRef!==0&&(i.stencilRef=this.stencilRef),this.stencilFuncMask!==255&&(i.stencilFuncMask=this.stencilFuncMask),this.stencilFail!==Fr&&(i.stencilFail=this.stencilFail),this.stencilZFail!==Fr&&(i.stencilZFail=this.stencilZFail),this.stencilZPass!==Fr&&(i.stencilZPass=this.stencilZPass),this.stencilWrite===!0&&(i.stencilWrite=this.stencilWrite),this.rotation!==void 0&&this.rotation!==0&&(i.rotation=this.rotation),this.polygonOffset===!0&&(i.polygonOffset=!0),this.polygonOffsetFactor!==0&&(i.polygonOffsetFactor=this.polygonOffsetFactor),this.polygonOffsetUnits!==0&&(i.polygonOffsetUnits=this.polygonOffsetUnits),this.linewidth!==void 0&&this.linewidth!==1&&(i.linewidth=this.linewidth),this.dashSize!==void 0&&(i.dashSize=this.dashSize),this.gapSize!==void 0&&(i.gapSize=this.gapSize),this.scale!==void 0&&(i.scale=this.scale),this.dithering===!0&&(i.dithering=!0),this.alphaTest>0&&(i.alphaTest=this.alphaTest),this.alphaHash===!0&&(i.alphaHash=!0),this.alphaToCoverage===!0&&(i.alphaToCoverage=!0),this.premultipliedAlpha===!0&&(i.premultipliedAlpha=!0),this.forceSinglePass===!0&&(i.forceSinglePass=!0),this.wireframe===!0&&(i.wireframe=!0),this.wireframeLinewidth>1&&(i.wireframeLinewidth=this.wireframeLinewidth),this.wireframeLinecap!=="round"&&(i.wireframeLinecap=this.wireframeLinecap),this.wireframeLinejoin!=="round"&&(i.wireframeLinejoin=this.wireframeLinejoin),this.flatShading===!0&&(i.flatShading=!0),this.visible===!1&&(i.visible=!1),this.toneMapped===!1&&(i.toneMapped=!1),this.fog===!1&&(i.fog=!1),Object.keys(this.userData).length>0&&(i.userData=this.userData);function r(s){const o=[];for(const a in s){const l=s[a];delete l.metadata,o.push(l)}return o}if(t){const s=r(e.textures),o=r(e.images);s.length>0&&(i.textures=s),o.length>0&&(i.images=o)}return i}clone(){return new this.constructor().copy(this)}copy(e){this.name=e.name,this.blending=e.blending,this.side=e.side,this.vertexColors=e.vertexColors,this.opacity=e.opacity,this.transparent=e.transparent,this.blendSrc=e.blendSrc,this.blendDst=e.blendDst,this.blendEquation=e.blendEquation,this.blendSrcAlpha=e.blendSrcAlpha,this.blendDstAlpha=e.blendDstAlpha,this.blendEquationAlpha=e.blendEquationAlpha,this.blendColor.copy(e.blendColor),this.blendAlpha=e.blendAlpha,this.depthFunc=e.depthFunc,this.depthTest=e.depthTest,this.depthWrite=e.depthWrite,this.stencilWriteMask=e.stencilWriteMask,this.stencilFunc=e.stencilFunc,this.stencilRef=e.stencilRef,this.stencilFuncMask=e.stencilFuncMask,this.stencilFail=e.stencilFail,this.stencilZFail=e.stencilZFail,this.stencilZPass=e.stencilZPass,this.stencilWrite=e.stencilWrite;const t=e.clippingPlanes;let i=null;if(t!==null){const r=t.length;i=new Array(r);for(let s=0;s!==r;++s)i[s]=t[s].clone()}return this.clippingPlanes=i,this.clipIntersection=e.clipIntersection,this.clipShadows=e.clipShadows,this.shadowSide=e.shadowSide,this.colorWrite=e.colorWrite,this.precision=e.precision,this.polygonOffset=e.polygonOffset,this.polygonOffsetFactor=e.polygonOffsetFactor,this.polygonOffsetUnits=e.polygonOffsetUnits,this.dithering=e.dithering,this.alphaTest=e.alphaTest,this.alphaHash=e.alphaHash,this.alphaToCoverage=e.alphaToCoverage,this.premultipliedAlpha=e.premultipliedAlpha,this.forceSinglePass=e.forceSinglePass,this.visible=e.visible,this.toneMapped=e.toneMapped,this.userData=JSON.parse(JSON.stringify(e.userData)),this}dispose(){this.dispatchEvent({type:"dispose"})}set needsUpdate(e){e===!0&&this.version++}onBuild(){console.warn("Material: onBuild() has been removed.")}}class Lu extends Tr{constructor(e){super(),this.isMeshBasicMaterial=!0,this.type="MeshBasicMaterial",this.color=new Ke(16777215),this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new ui,this.combine=Wf,this.reflectivity=1,this.refractionRatio=.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.specularMap=e.specularMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapRotation.copy(e.envMapRotation),this.combine=e.combine,this.reflectivity=e.reflectivity,this.refractionRatio=e.refractionRatio,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.fog=e.fog,this}}const It=new z,zo=new Xe;class pt{constructor(e,t,i=!1){if(Array.isArray(e))throw new TypeError("THREE.BufferAttribute: array should be a Typed Array.");this.isBufferAttribute=!0,this.name="",this.array=e,this.itemSize=t,this.count=e!==void 0?e.length/t:0,this.normalized=i,this.usage=Ud,this.updateRanges=[],this.gpuType=Ai,this.version=0}onUploadCallback(){}set needsUpdate(e){e===!0&&this.version++}setUsage(e){return this.usage=e,this}addUpdateRange(e,t){this.updateRanges.push({start:e,count:t})}clearUpdateRanges(){this.updateRanges.length=0}copy(e){return this.name=e.name,this.array=new e.array.constructor(e.array),this.itemSize=e.itemSize,this.count=e.count,this.normalized=e.normalized,this.usage=e.usage,this.gpuType=e.gpuType,this}copyAt(e,t,i){e*=this.itemSize,i*=t.itemSize;for(let r=0,s=this.itemSize;r<s;r++)this.array[e+r]=t.array[i+r];return this}copyArray(e){return this.array.set(e),this}applyMatrix3(e){if(this.itemSize===2)for(let t=0,i=this.count;t<i;t++)zo.fromBufferAttribute(this,t),zo.applyMatrix3(e),this.setXY(t,zo.x,zo.y);else if(this.itemSize===3)for(let t=0,i=this.count;t<i;t++)It.fromBufferAttribute(this,t),It.applyMatrix3(e),this.setXYZ(t,It.x,It.y,It.z);return this}applyMatrix4(e){for(let t=0,i=this.count;t<i;t++)It.fromBufferAttribute(this,t),It.applyMatrix4(e),this.setXYZ(t,It.x,It.y,It.z);return this}applyNormalMatrix(e){for(let t=0,i=this.count;t<i;t++)It.fromBufferAttribute(this,t),It.applyNormalMatrix(e),this.setXYZ(t,It.x,It.y,It.z);return this}transformDirection(e){for(let t=0,i=this.count;t<i;t++)It.fromBufferAttribute(this,t),It.transformDirection(e),this.setXYZ(t,It.x,It.y,It.z);return this}set(e,t=0){return this.array.set(e,t),this}getComponent(e,t){let i=this.array[e*this.itemSize+t];return this.normalized&&(i=ls(i,this.array)),i}setComponent(e,t,i){return this.normalized&&(i=fn(i,this.array)),this.array[e*this.itemSize+t]=i,this}getX(e){let t=this.array[e*this.itemSize];return this.normalized&&(t=ls(t,this.array)),t}setX(e,t){return this.normalized&&(t=fn(t,this.array)),this.array[e*this.itemSize]=t,this}getY(e){let t=this.array[e*this.itemSize+1];return this.normalized&&(t=ls(t,this.array)),t}setY(e,t){return this.normalized&&(t=fn(t,this.array)),this.array[e*this.itemSize+1]=t,this}getZ(e){let t=this.array[e*this.itemSize+2];return this.normalized&&(t=ls(t,this.array)),t}setZ(e,t){return this.normalized&&(t=fn(t,this.array)),this.array[e*this.itemSize+2]=t,this}getW(e){let t=this.array[e*this.itemSize+3];return this.normalized&&(t=ls(t,this.array)),t}setW(e,t){return this.normalized&&(t=fn(t,this.array)),this.array[e*this.itemSize+3]=t,this}setXY(e,t,i){return e*=this.itemSize,this.normalized&&(t=fn(t,this.array),i=fn(i,this.array)),this.array[e+0]=t,this.array[e+1]=i,this}setXYZ(e,t,i,r){return e*=this.itemSize,this.normalized&&(t=fn(t,this.array),i=fn(i,this.array),r=fn(r,this.array)),this.array[e+0]=t,this.array[e+1]=i,this.array[e+2]=r,this}setXYZW(e,t,i,r,s){return e*=this.itemSize,this.normalized&&(t=fn(t,this.array),i=fn(i,this.array),r=fn(r,this.array),s=fn(s,this.array)),this.array[e+0]=t,this.array[e+1]=i,this.array[e+2]=r,this.array[e+3]=s,this}onUpload(e){return this.onUploadCallback=e,this}clone(){return new this.constructor(this.array,this.itemSize).copy(this)}toJSON(){const e={itemSize:this.itemSize,type:this.array.constructor.name,array:Array.from(this.array),normalized:this.normalized};return this.name!==""&&(e.name=this.name),this.usage!==Ud&&(e.usage=this.usage),e}}class lp extends pt{constructor(e,t,i){super(new Uint16Array(e),t,i)}}class cp extends pt{constructor(e,t,i){super(new Uint32Array(e),t,i)}}class Ft extends pt{constructor(e,t,i){super(new Float32Array(e),t,i)}}let P0=0;const Un=new ht,Nl=new Jt,Xr=new z,Pn=new $t,Vs=new $t,qt=new z;class Ct extends Er{constructor(){super(),this.isBufferGeometry=!0,Object.defineProperty(this,"id",{value:P0++}),this.uuid=Ts(),this.name="",this.type="BufferGeometry",this.index=null,this.attributes={},this.morphAttributes={},this.morphTargetsRelative=!1,this.groups=[],this.boundingBox=null,this.boundingSphere=null,this.drawRange={start:0,count:1/0},this.userData={}}getIndex(){return this.index}setIndex(e){return Array.isArray(e)?this.index=new(sp(e)?cp:lp)(e,1):this.index=e,this}getAttribute(e){return this.attributes[e]}setAttribute(e,t){return this.attributes[e]=t,this}deleteAttribute(e){return delete this.attributes[e],this}hasAttribute(e){return this.attributes[e]!==void 0}addGroup(e,t,i=0){this.groups.push({start:e,count:t,materialIndex:i})}clearGroups(){this.groups=[]}setDrawRange(e,t){this.drawRange.start=e,this.drawRange.count=t}applyMatrix4(e){const t=this.attributes.position;t!==void 0&&(t.applyMatrix4(e),t.needsUpdate=!0);const i=this.attributes.normal;if(i!==void 0){const s=new rt().getNormalMatrix(e);i.applyNormalMatrix(s),i.needsUpdate=!0}const r=this.attributes.tangent;return r!==void 0&&(r.transformDirection(e),r.needsUpdate=!0),this.boundingBox!==null&&this.computeBoundingBox(),this.boundingSphere!==null&&this.computeBoundingSphere(),this}applyQuaternion(e){return Un.makeRotationFromQuaternion(e),this.applyMatrix4(Un),this}rotateX(e){return Un.makeRotationX(e),this.applyMatrix4(Un),this}rotateY(e){return Un.makeRotationY(e),this.applyMatrix4(Un),this}rotateZ(e){return Un.makeRotationZ(e),this.applyMatrix4(Un),this}translate(e,t,i){return Un.makeTranslation(e,t,i),this.applyMatrix4(Un),this}scale(e,t,i){return Un.makeScale(e,t,i),this.applyMatrix4(Un),this}lookAt(e){return Nl.lookAt(e),Nl.updateMatrix(),this.applyMatrix4(Nl.matrix),this}center(){return this.computeBoundingBox(),this.boundingBox.getCenter(Xr).negate(),this.translate(Xr.x,Xr.y,Xr.z),this}setFromPoints(e){const t=[];for(let i=0,r=e.length;i<r;i++){const s=e[i];t.push(s.x,s.y,s.z||0)}return this.setAttribute("position",new Ft(t,3)),this}computeBoundingBox(){this.boundingBox===null&&(this.boundingBox=new $t);const e=this.attributes.position,t=this.morphAttributes.position;if(e&&e.isGLBufferAttribute){console.error("THREE.BufferGeometry.computeBoundingBox(): GLBufferAttribute requires a manual bounding box.",this),this.boundingBox.set(new z(-1/0,-1/0,-1/0),new z(1/0,1/0,1/0));return}if(e!==void 0){if(this.boundingBox.setFromBufferAttribute(e),t)for(let i=0,r=t.length;i<r;i++){const s=t[i];Pn.setFromBufferAttribute(s),this.morphTargetsRelative?(qt.addVectors(this.boundingBox.min,Pn.min),this.boundingBox.expandByPoint(qt),qt.addVectors(this.boundingBox.max,Pn.max),this.boundingBox.expandByPoint(qt)):(this.boundingBox.expandByPoint(Pn.min),this.boundingBox.expandByPoint(Pn.max))}}else this.boundingBox.makeEmpty();(isNaN(this.boundingBox.min.x)||isNaN(this.boundingBox.min.y)||isNaN(this.boundingBox.min.z))&&console.error('THREE.BufferGeometry.computeBoundingBox(): Computed min/max have NaN values. The "position" attribute is likely to have NaN values.',this)}computeBoundingSphere(){this.boundingSphere===null&&(this.boundingSphere=new As);const e=this.attributes.position,t=this.morphAttributes.position;if(e&&e.isGLBufferAttribute){console.error("THREE.BufferGeometry.computeBoundingSphere(): GLBufferAttribute requires a manual bounding sphere.",this),this.boundingSphere.set(new z,1/0);return}if(e){const i=this.boundingSphere.center;if(Pn.setFromBufferAttribute(e),t)for(let s=0,o=t.length;s<o;s++){const a=t[s];Vs.setFromBufferAttribute(a),this.morphTargetsRelative?(qt.addVectors(Pn.min,Vs.min),Pn.expandByPoint(qt),qt.addVectors(Pn.max,Vs.max),Pn.expandByPoint(qt)):(Pn.expandByPoint(Vs.min),Pn.expandByPoint(Vs.max))}Pn.getCenter(i);let r=0;for(let s=0,o=e.count;s<o;s++)qt.fromBufferAttribute(e,s),r=Math.max(r,i.distanceToSquared(qt));if(t)for(let s=0,o=t.length;s<o;s++){const a=t[s],l=this.morphTargetsRelative;for(let c=0,u=a.count;c<u;c++)qt.fromBufferAttribute(a,c),l&&(Xr.fromBufferAttribute(e,c),qt.add(Xr)),r=Math.max(r,i.distanceToSquared(qt))}this.boundingSphere.radius=Math.sqrt(r),isNaN(this.boundingSphere.radius)&&console.error('THREE.BufferGeometry.computeBoundingSphere(): Computed radius is NaN. The "position" attribute is likely to have NaN values.',this)}}computeTangents(){const e=this.index,t=this.attributes;if(e===null||t.position===void 0||t.normal===void 0||t.uv===void 0){console.error("THREE.BufferGeometry: .computeTangents() failed. Missing required attributes (index, position, normal or uv)");return}const i=t.position,r=t.normal,s=t.uv;this.hasAttribute("tangent")===!1&&this.setAttribute("tangent",new pt(new Float32Array(4*i.count),4));const o=this.getAttribute("tangent"),a=[],l=[];for(let D=0;D<i.count;D++)a[D]=new z,l[D]=new z;const c=new z,u=new z,d=new z,h=new Xe,f=new Xe,_=new Xe,v=new z,g=new z;function m(D,$,b){c.fromBufferAttribute(i,D),u.fromBufferAttribute(i,$),d.fromBufferAttribute(i,b),h.fromBufferAttribute(s,D),f.fromBufferAttribute(s,$),_.fromBufferAttribute(s,b),u.sub(c),d.sub(c),f.sub(h),_.sub(h);const E=1/(f.x*_.y-_.x*f.y);isFinite(E)&&(v.copy(u).multiplyScalar(_.y).addScaledVector(d,-f.y).multiplyScalar(E),g.copy(d).multiplyScalar(f.x).addScaledVector(u,-_.x).multiplyScalar(E),a[D].add(v),a[$].add(v),a[b].add(v),l[D].add(g),l[$].add(g),l[b].add(g))}let y=this.groups;y.length===0&&(y=[{start:0,count:e.count}]);for(let D=0,$=y.length;D<$;++D){const b=y[D],E=b.start,F=b.count;for(let O=E,X=E+F;O<X;O+=3)m(e.getX(O+0),e.getX(O+1),e.getX(O+2))}const S=new z,M=new z,R=new z,A=new z;function C(D){R.fromBufferAttribute(r,D),A.copy(R);const $=a[D];S.copy($),S.sub(R.multiplyScalar(R.dot($))).normalize(),M.crossVectors(A,$);const E=M.dot(l[D])<0?-1:1;o.setXYZW(D,S.x,S.y,S.z,E)}for(let D=0,$=y.length;D<$;++D){const b=y[D],E=b.start,F=b.count;for(let O=E,X=E+F;O<X;O+=3)C(e.getX(O+0)),C(e.getX(O+1)),C(e.getX(O+2))}}computeVertexNormals(){const e=this.index,t=this.getAttribute("position");if(t!==void 0){let i=this.getAttribute("normal");if(i===void 0)i=new pt(new Float32Array(t.count*3),3),this.setAttribute("normal",i);else for(let h=0,f=i.count;h<f;h++)i.setXYZ(h,0,0,0);const r=new z,s=new z,o=new z,a=new z,l=new z,c=new z,u=new z,d=new z;if(e)for(let h=0,f=e.count;h<f;h+=3){const _=e.getX(h+0),v=e.getX(h+1),g=e.getX(h+2);r.fromBufferAttribute(t,_),s.fromBufferAttribute(t,v),o.fromBufferAttribute(t,g),u.subVectors(o,s),d.subVectors(r,s),u.cross(d),a.fromBufferAttribute(i,_),l.fromBufferAttribute(i,v),c.fromBufferAttribute(i,g),a.add(u),l.add(u),c.add(u),i.setXYZ(_,a.x,a.y,a.z),i.setXYZ(v,l.x,l.y,l.z),i.setXYZ(g,c.x,c.y,c.z)}else for(let h=0,f=t.count;h<f;h+=3)r.fromBufferAttribute(t,h+0),s.fromBufferAttribute(t,h+1),o.fromBufferAttribute(t,h+2),u.subVectors(o,s),d.subVectors(r,s),u.cross(d),i.setXYZ(h+0,u.x,u.y,u.z),i.setXYZ(h+1,u.x,u.y,u.z),i.setXYZ(h+2,u.x,u.y,u.z);this.normalizeNormals(),i.needsUpdate=!0}}normalizeNormals(){const e=this.attributes.normal;for(let t=0,i=e.count;t<i;t++)qt.fromBufferAttribute(e,t),qt.normalize(),e.setXYZ(t,qt.x,qt.y,qt.z)}toNonIndexed(){function e(a,l){const c=a.array,u=a.itemSize,d=a.normalized,h=new c.constructor(l.length*u);let f=0,_=0;for(let v=0,g=l.length;v<g;v++){a.isInterleavedBufferAttribute?f=l[v]*a.data.stride+a.offset:f=l[v]*u;for(let m=0;m<u;m++)h[_++]=c[f++]}return new pt(h,u,d)}if(this.index===null)return console.warn("THREE.BufferGeometry.toNonIndexed(): BufferGeometry is already non-indexed."),this;const t=new Ct,i=this.index.array,r=this.attributes;for(const a in r){const l=r[a],c=e(l,i);t.setAttribute(a,c)}const s=this.morphAttributes;for(const a in s){const l=[],c=s[a];for(let u=0,d=c.length;u<d;u++){const h=c[u],f=e(h,i);l.push(f)}t.morphAttributes[a]=l}t.morphTargetsRelative=this.morphTargetsRelative;const o=this.groups;for(let a=0,l=o.length;a<l;a++){const c=o[a];t.addGroup(c.start,c.count,c.materialIndex)}return t}toJSON(){const e={metadata:{version:4.6,type:"BufferGeometry",generator:"BufferGeometry.toJSON"}};if(e.uuid=this.uuid,e.type=this.type,this.name!==""&&(e.name=this.name),Object.keys(this.userData).length>0&&(e.userData=this.userData),this.parameters!==void 0){const l=this.parameters;for(const c in l)l[c]!==void 0&&(e[c]=l[c]);return e}e.data={attributes:{}};const t=this.index;t!==null&&(e.data.index={type:t.array.constructor.name,array:Array.prototype.slice.call(t.array)});const i=this.attributes;for(const l in i){const c=i[l];e.data.attributes[l]=c.toJSON(e.data)}const r={};let s=!1;for(const l in this.morphAttributes){const c=this.morphAttributes[l],u=[];for(let d=0,h=c.length;d<h;d++){const f=c[d];u.push(f.toJSON(e.data))}u.length>0&&(r[l]=u,s=!0)}s&&(e.data.morphAttributes=r,e.data.morphTargetsRelative=this.morphTargetsRelative);const o=this.groups;o.length>0&&(e.data.groups=JSON.parse(JSON.stringify(o)));const a=this.boundingSphere;return a!==null&&(e.data.boundingSphere={center:a.center.toArray(),radius:a.radius}),e}clone(){return new this.constructor().copy(this)}copy(e){this.index=null,this.attributes={},this.morphAttributes={},this.groups=[],this.boundingBox=null,this.boundingSphere=null;const t={};this.name=e.name;const i=e.index;i!==null&&this.setIndex(i.clone(t));const r=e.attributes;for(const c in r){const u=r[c];this.setAttribute(c,u.clone(t))}const s=e.morphAttributes;for(const c in s){const u=[],d=s[c];for(let h=0,f=d.length;h<f;h++)u.push(d[h].clone(t));this.morphAttributes[c]=u}this.morphTargetsRelative=e.morphTargetsRelative;const o=e.groups;for(let c=0,u=o.length;c<u;c++){const d=o[c];this.addGroup(d.start,d.count,d.materialIndex)}const a=e.boundingBox;a!==null&&(this.boundingBox=a.clone());const l=e.boundingSphere;return l!==null&&(this.boundingSphere=l.clone()),this.drawRange.start=e.drawRange.start,this.drawRange.count=e.drawRange.count,this.userData=e.userData,this}dispose(){this.dispatchEvent({type:"dispose"})}}const Zd=new ht,hr=new Ri,Ho=new As,Kd=new z,Vo=new z,Go=new z,Wo=new z,Ul=new z,$o=new z,Jd=new z,Xo=new z;class gn extends Jt{constructor(e=new Ct,t=new Lu){super(),this.isMesh=!0,this.type="Mesh",this.geometry=e,this.material=t,this.updateMorphTargets()}copy(e,t){return super.copy(e,t),e.morphTargetInfluences!==void 0&&(this.morphTargetInfluences=e.morphTargetInfluences.slice()),e.morphTargetDictionary!==void 0&&(this.morphTargetDictionary=Object.assign({},e.morphTargetDictionary)),this.material=Array.isArray(e.material)?e.material.slice():e.material,this.geometry=e.geometry,this}updateMorphTargets(){const t=this.geometry.morphAttributes,i=Object.keys(t);if(i.length>0){const r=t[i[0]];if(r!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let s=0,o=r.length;s<o;s++){const a=r[s].name||String(s);this.morphTargetInfluences.push(0),this.morphTargetDictionary[a]=s}}}}getVertexPosition(e,t){const i=this.geometry,r=i.attributes.position,s=i.morphAttributes.position,o=i.morphTargetsRelative;t.fromBufferAttribute(r,e);const a=this.morphTargetInfluences;if(s&&a){$o.set(0,0,0);for(let l=0,c=s.length;l<c;l++){const u=a[l],d=s[l];u!==0&&(Ul.fromBufferAttribute(d,e),o?$o.addScaledVector(Ul,u):$o.addScaledVector(Ul.sub(t),u))}t.add($o)}return t}raycast(e,t){const i=this.geometry,r=this.material,s=this.matrixWorld;r!==void 0&&(i.boundingSphere===null&&i.computeBoundingSphere(),Ho.copy(i.boundingSphere),Ho.applyMatrix4(s),hr.copy(e.ray).recast(e.near),!(Ho.containsPoint(hr.origin)===!1&&(hr.intersectSphere(Ho,Kd)===null||hr.origin.distanceToSquared(Kd)>(e.far-e.near)**2))&&(Zd.copy(s).invert(),hr.copy(e.ray).applyMatrix4(Zd),!(i.boundingBox!==null&&hr.intersectsBox(i.boundingBox)===!1)&&this._computeIntersections(e,t,hr)))}_computeIntersections(e,t,i){let r;const s=this.geometry,o=this.material,a=s.index,l=s.attributes.position,c=s.attributes.uv,u=s.attributes.uv1,d=s.attributes.normal,h=s.groups,f=s.drawRange;if(a!==null)if(Array.isArray(o))for(let _=0,v=h.length;_<v;_++){const g=h[_],m=o[g.materialIndex],y=Math.max(g.start,f.start),S=Math.min(a.count,Math.min(g.start+g.count,f.start+f.count));for(let M=y,R=S;M<R;M+=3){const A=a.getX(M),C=a.getX(M+1),D=a.getX(M+2);r=jo(this,m,e,i,c,u,d,A,C,D),r&&(r.faceIndex=Math.floor(M/3),r.face.materialIndex=g.materialIndex,t.push(r))}}else{const _=Math.max(0,f.start),v=Math.min(a.count,f.start+f.count);for(let g=_,m=v;g<m;g+=3){const y=a.getX(g),S=a.getX(g+1),M=a.getX(g+2);r=jo(this,o,e,i,c,u,d,y,S,M),r&&(r.faceIndex=Math.floor(g/3),t.push(r))}}else if(l!==void 0)if(Array.isArray(o))for(let _=0,v=h.length;_<v;_++){const g=h[_],m=o[g.materialIndex],y=Math.max(g.start,f.start),S=Math.min(l.count,Math.min(g.start+g.count,f.start+f.count));for(let M=y,R=S;M<R;M+=3){const A=M,C=M+1,D=M+2;r=jo(this,m,e,i,c,u,d,A,C,D),r&&(r.faceIndex=Math.floor(M/3),r.face.materialIndex=g.materialIndex,t.push(r))}}else{const _=Math.max(0,f.start),v=Math.min(l.count,f.start+f.count);for(let g=_,m=v;g<m;g+=3){const y=g,S=g+1,M=g+2;r=jo(this,o,e,i,c,u,d,y,S,M),r&&(r.faceIndex=Math.floor(g/3),t.push(r))}}}}function R0(n,e,t,i,r,s,o,a){let l;if(e.side===un?l=i.intersectTriangle(o,s,r,!0,a):l=i.intersectTriangle(r,s,o,e.side===In,a),l===null)return null;Xo.copy(a),Xo.applyMatrix4(n.matrixWorld);const c=t.ray.origin.distanceTo(Xo);return c<t.near||c>t.far?null:{distance:c,point:Xo.clone(),object:n}}function jo(n,e,t,i,r,s,o,a,l,c){n.getVertexPosition(a,Vo),n.getVertexPosition(l,Go),n.getVertexPosition(c,Wo);const u=R0(n,e,t,i,Vo,Go,Wo,Jd);if(u){const d=new z;tn.getBarycoord(Jd,Vo,Go,Wo,d),r&&(u.uv=tn.getInterpolatedAttribute(r,a,l,c,d,new Xe)),s&&(u.uv1=tn.getInterpolatedAttribute(s,a,l,c,d,new Xe)),o&&(u.normal=tn.getInterpolatedAttribute(o,a,l,c,d,new z),u.normal.dot(i.direction)>0&&u.normal.multiplyScalar(-1));const h={a,b:l,c,normal:new z,materialIndex:0};tn.getNormal(Vo,Go,Wo,h.normal),u.face=h,u.barycoord=d}return u}class Cs extends Ct{constructor(e=1,t=1,i=1,r=1,s=1,o=1){super(),this.type="BoxGeometry",this.parameters={width:e,height:t,depth:i,widthSegments:r,heightSegments:s,depthSegments:o};const a=this;r=Math.floor(r),s=Math.floor(s),o=Math.floor(o);const l=[],c=[],u=[],d=[];let h=0,f=0;_("z","y","x",-1,-1,i,t,e,o,s,0),_("z","y","x",1,-1,i,t,-e,o,s,1),_("x","z","y",1,1,e,i,t,r,o,2),_("x","z","y",1,-1,e,i,-t,r,o,3),_("x","y","z",1,-1,e,t,i,r,s,4),_("x","y","z",-1,-1,e,t,-i,r,s,5),this.setIndex(l),this.setAttribute("position",new Ft(c,3)),this.setAttribute("normal",new Ft(u,3)),this.setAttribute("uv",new Ft(d,2));function _(v,g,m,y,S,M,R,A,C,D,$){const b=M/C,E=R/D,F=M/2,O=R/2,X=A/2,re=C+1,K=D+1;let he=0,j=0;const Ee=new z;for(let _e=0;_e<K;_e++){const Se=_e*E-O;for(let Me=0;Me<re;Me++){const ze=Me*b-F;Ee[v]=ze*y,Ee[g]=Se*S,Ee[m]=X,c.push(Ee.x,Ee.y,Ee.z),Ee[v]=0,Ee[g]=0,Ee[m]=A>0?1:-1,u.push(Ee.x,Ee.y,Ee.z),d.push(Me/C),d.push(1-_e/D),he+=1}}for(let _e=0;_e<D;_e++)for(let Se=0;Se<C;Se++){const Me=h+Se+re*_e,ze=h+Se+re*(_e+1),ue=h+(Se+1)+re*(_e+1),me=h+(Se+1)+re*_e;l.push(Me,ze,me),l.push(ze,ue,me),j+=6}a.addGroup(f,j,$),f+=j,h+=he}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new Cs(e.width,e.height,e.depth,e.widthSegments,e.heightSegments,e.depthSegments)}}function ws(n){const e={};for(const t in n){e[t]={};for(const i in n[t]){const r=n[t][i];r&&(r.isColor||r.isMatrix3||r.isMatrix4||r.isVector2||r.isVector3||r.isVector4||r.isTexture||r.isQuaternion)?r.isRenderTargetTexture?(console.warn("UniformsUtils: Textures of render targets cannot be cloned via cloneUniforms() or mergeUniforms()."),e[t][i]=null):e[t][i]=r.clone():Array.isArray(r)?e[t][i]=r.slice():e[t][i]=r}}return e}function pn(n){const e={};for(let t=0;t<n.length;t++){const i=ws(n[t]);for(const r in i)e[r]=i[r]}return e}function L0(n){const e=[];for(let t=0;t<n.length;t++)e.push(n[t].clone());return e}function up(n){const e=n.getRenderTarget();return e===null?n.outputColorSpace:e.isXRRenderTarget===!0?e.texture.colorSpace:ft.workingColorSpace}const I0={clone:ws,merge:pn};var D0=`void main() {
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`,N0=`void main() {
	gl_FragColor = vec4( 1.0, 0.0, 0.0, 1.0 );
}`;class Dn extends Tr{constructor(e){super(),this.isShaderMaterial=!0,this.type="ShaderMaterial",this.defines={},this.uniforms={},this.uniformsGroups=[],this.vertexShader=D0,this.fragmentShader=N0,this.linewidth=1,this.wireframe=!1,this.wireframeLinewidth=1,this.fog=!1,this.lights=!1,this.clipping=!1,this.forceSinglePass=!0,this.extensions={clipCullDistance:!1,multiDraw:!1},this.defaultAttributeValues={color:[1,1,1],uv:[0,0],uv1:[0,0]},this.index0AttributeName=void 0,this.uniformsNeedUpdate=!1,this.glslVersion=null,e!==void 0&&this.setValues(e)}copy(e){return super.copy(e),this.fragmentShader=e.fragmentShader,this.vertexShader=e.vertexShader,this.uniforms=ws(e.uniforms),this.uniformsGroups=L0(e.uniformsGroups),this.defines=Object.assign({},e.defines),this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.fog=e.fog,this.lights=e.lights,this.clipping=e.clipping,this.extensions=Object.assign({},e.extensions),this.glslVersion=e.glslVersion,this}toJSON(e){const t=super.toJSON(e);t.glslVersion=this.glslVersion,t.uniforms={};for(const r in this.uniforms){const o=this.uniforms[r].value;o&&o.isTexture?t.uniforms[r]={type:"t",value:o.toJSON(e).uuid}:o&&o.isColor?t.uniforms[r]={type:"c",value:o.getHex()}:o&&o.isVector2?t.uniforms[r]={type:"v2",value:o.toArray()}:o&&o.isVector3?t.uniforms[r]={type:"v3",value:o.toArray()}:o&&o.isVector4?t.uniforms[r]={type:"v4",value:o.toArray()}:o&&o.isMatrix3?t.uniforms[r]={type:"m3",value:o.toArray()}:o&&o.isMatrix4?t.uniforms[r]={type:"m4",value:o.toArray()}:t.uniforms[r]={value:o}}Object.keys(this.defines).length>0&&(t.defines=this.defines),t.vertexShader=this.vertexShader,t.fragmentShader=this.fragmentShader,t.lights=this.lights,t.clipping=this.clipping;const i={};for(const r in this.extensions)this.extensions[r]===!0&&(i[r]=!0);return Object.keys(i).length>0&&(t.extensions=i),t}}class dp extends Jt{constructor(){super(),this.isCamera=!0,this.type="Camera",this.matrixWorldInverse=new ht,this.projectionMatrix=new ht,this.projectionMatrixInverse=new ht,this.coordinateSystem=Ci}copy(e,t){return super.copy(e,t),this.matrixWorldInverse.copy(e.matrixWorldInverse),this.projectionMatrix.copy(e.projectionMatrix),this.projectionMatrixInverse.copy(e.projectionMatrixInverse),this.coordinateSystem=e.coordinateSystem,this}getWorldDirection(e){return super.getWorldDirection(e).negate()}updateMatrixWorld(e){super.updateMatrixWorld(e),this.matrixWorldInverse.copy(this.matrixWorld).invert()}updateWorldMatrix(e,t){super.updateWorldMatrix(e,t),this.matrixWorldInverse.copy(this.matrixWorld).invert()}clone(){return new this.constructor().copy(this)}}const Gi=new z,Qd=new Xe,eh=new Xe;class kn extends dp{constructor(e=50,t=1,i=.1,r=2e3){super(),this.isPerspectiveCamera=!0,this.type="PerspectiveCamera",this.fov=e,this.zoom=1,this.near=i,this.far=r,this.focus=10,this.aspect=t,this.view=null,this.filmGauge=35,this.filmOffset=0,this.updateProjectionMatrix()}copy(e,t){return super.copy(e,t),this.fov=e.fov,this.zoom=e.zoom,this.near=e.near,this.far=e.far,this.focus=e.focus,this.aspect=e.aspect,this.view=e.view===null?null:Object.assign({},e.view),this.filmGauge=e.filmGauge,this.filmOffset=e.filmOffset,this}setFocalLength(e){const t=.5*this.getFilmHeight()/e;this.fov=uo*2*Math.atan(t),this.updateProjectionMatrix()}getFocalLength(){const e=Math.tan(so*.5*this.fov);return .5*this.getFilmHeight()/e}getEffectiveFOV(){return uo*2*Math.atan(Math.tan(so*.5*this.fov)/this.zoom)}getFilmWidth(){return this.filmGauge*Math.min(this.aspect,1)}getFilmHeight(){return this.filmGauge/Math.max(this.aspect,1)}getViewBounds(e,t,i){Gi.set(-1,-1,.5).applyMatrix4(this.projectionMatrixInverse),t.set(Gi.x,Gi.y).multiplyScalar(-e/Gi.z),Gi.set(1,1,.5).applyMatrix4(this.projectionMatrixInverse),i.set(Gi.x,Gi.y).multiplyScalar(-e/Gi.z)}getViewSize(e,t){return this.getViewBounds(e,Qd,eh),t.subVectors(eh,Qd)}setViewOffset(e,t,i,r,s,o){this.aspect=e/t,this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=e,this.view.fullHeight=t,this.view.offsetX=i,this.view.offsetY=r,this.view.width=s,this.view.height=o,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){const e=this.near;let t=e*Math.tan(so*.5*this.fov)/this.zoom,i=2*t,r=this.aspect*i,s=-.5*r;const o=this.view;if(this.view!==null&&this.view.enabled){const l=o.fullWidth,c=o.fullHeight;s+=o.offsetX*r/l,t-=o.offsetY*i/c,r*=o.width/l,i*=o.height/c}const a=this.filmOffset;a!==0&&(s+=e*a/this.getFilmWidth()),this.projectionMatrix.makePerspective(s,s+r,t,t-i,e,this.far,this.coordinateSystem),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(e){const t=super.toJSON(e);return t.object.fov=this.fov,t.object.zoom=this.zoom,t.object.near=this.near,t.object.far=this.far,t.object.focus=this.focus,t.object.aspect=this.aspect,this.view!==null&&(t.object.view=Object.assign({},this.view)),t.object.filmGauge=this.filmGauge,t.object.filmOffset=this.filmOffset,t}}const jr=-90,qr=1;class U0 extends Jt{constructor(e,t,i){super(),this.type="CubeCamera",this.renderTarget=i,this.coordinateSystem=null,this.activeMipmapLevel=0;const r=new kn(jr,qr,e,t);r.layers=this.layers,this.add(r);const s=new kn(jr,qr,e,t);s.layers=this.layers,this.add(s);const o=new kn(jr,qr,e,t);o.layers=this.layers,this.add(o);const a=new kn(jr,qr,e,t);a.layers=this.layers,this.add(a);const l=new kn(jr,qr,e,t);l.layers=this.layers,this.add(l);const c=new kn(jr,qr,e,t);c.layers=this.layers,this.add(c)}updateCoordinateSystem(){const e=this.coordinateSystem,t=this.children.concat(),[i,r,s,o,a,l]=t;for(const c of t)this.remove(c);if(e===Ci)i.up.set(0,1,0),i.lookAt(1,0,0),r.up.set(0,1,0),r.lookAt(-1,0,0),s.up.set(0,0,-1),s.lookAt(0,1,0),o.up.set(0,0,1),o.lookAt(0,-1,0),a.up.set(0,1,0),a.lookAt(0,0,1),l.up.set(0,1,0),l.lookAt(0,0,-1);else if(e===Fa)i.up.set(0,-1,0),i.lookAt(-1,0,0),r.up.set(0,-1,0),r.lookAt(1,0,0),s.up.set(0,0,1),s.lookAt(0,1,0),o.up.set(0,0,-1),o.lookAt(0,-1,0),a.up.set(0,-1,0),a.lookAt(0,0,1),l.up.set(0,-1,0),l.lookAt(0,0,-1);else throw new Error("THREE.CubeCamera.updateCoordinateSystem(): Invalid coordinate system: "+e);for(const c of t)this.add(c),c.updateMatrixWorld()}update(e,t){this.parent===null&&this.updateMatrixWorld();const{renderTarget:i,activeMipmapLevel:r}=this;this.coordinateSystem!==e.coordinateSystem&&(this.coordinateSystem=e.coordinateSystem,this.updateCoordinateSystem());const[s,o,a,l,c,u]=this.children,d=e.getRenderTarget(),h=e.getActiveCubeFace(),f=e.getActiveMipmapLevel(),_=e.xr.enabled;e.xr.enabled=!1;const v=i.texture.generateMipmaps;i.texture.generateMipmaps=!1,e.setRenderTarget(i,0,r),e.render(t,s),e.setRenderTarget(i,1,r),e.render(t,o),e.setRenderTarget(i,2,r),e.render(t,a),e.setRenderTarget(i,3,r),e.render(t,l),e.setRenderTarget(i,4,r),e.render(t,c),i.texture.generateMipmaps=v,e.setRenderTarget(i,5,r),e.render(t,u),e.setRenderTarget(d,h,f),e.xr.enabled=_,i.texture.needsPMREMUpdate=!0}}class hp extends nn{constructor(e,t,i,r,s,o,a,l,c,u){e=e!==void 0?e:[],t=t!==void 0?t:xs,super(e,t,i,r,s,o,a,l,c,u),this.isCubeTexture=!0,this.flipY=!1}get images(){return this.image}set images(e){this.image=e}}class F0 extends nr{constructor(e=1,t={}){super(e,e,t),this.isWebGLCubeRenderTarget=!0;const i={width:e,height:e,depth:1},r=[i,i,i,i,i,i];this.texture=new hp(r,t.mapping,t.wrapS,t.wrapT,t.magFilter,t.minFilter,t.format,t.type,t.anisotropy,t.colorSpace),this.texture.isRenderTargetTexture=!0,this.texture.generateMipmaps=t.generateMipmaps!==void 0?t.generateMipmaps:!1,this.texture.minFilter=t.minFilter!==void 0?t.minFilter:zn}fromEquirectangularTexture(e,t){this.texture.type=t.type,this.texture.colorSpace=t.colorSpace,this.texture.generateMipmaps=t.generateMipmaps,this.texture.minFilter=t.minFilter,this.texture.magFilter=t.magFilter;const i={uniforms:{tEquirect:{value:null}},vertexShader:`

				varying vec3 vWorldDirection;

				vec3 transformDirection( in vec3 dir, in mat4 matrix ) {

					return normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );

				}

				void main() {

					vWorldDirection = transformDirection( position, modelMatrix );

					#include <begin_vertex>
					#include <project_vertex>

				}
			`,fragmentShader:`

				uniform sampler2D tEquirect;

				varying vec3 vWorldDirection;

				#include <common>

				void main() {

					vec3 direction = normalize( vWorldDirection );

					vec2 sampleUV = equirectUv( direction );

					gl_FragColor = texture2D( tEquirect, sampleUV );

				}
			`},r=new Cs(5,5,5),s=new Dn({name:"CubemapFromEquirect",uniforms:ws(i.uniforms),vertexShader:i.vertexShader,fragmentShader:i.fragmentShader,side:un,blending:er});s.uniforms.tEquirect.value=t;const o=new gn(r,s),a=t.minFilter;return t.minFilter===Ki&&(t.minFilter=zn),new U0(1,10,this).update(e,o),t.minFilter=a,o.geometry.dispose(),o.material.dispose(),this}clear(e,t,i,r){const s=e.getRenderTarget();for(let o=0;o<6;o++)e.setRenderTarget(this,o),e.clear(t,i,r);e.setRenderTarget(s)}}const Fl=new z,O0=new z,B0=new rt;class ri{constructor(e=new z(1,0,0),t=0){this.isPlane=!0,this.normal=e,this.constant=t}set(e,t){return this.normal.copy(e),this.constant=t,this}setComponents(e,t,i,r){return this.normal.set(e,t,i),this.constant=r,this}setFromNormalAndCoplanarPoint(e,t){return this.normal.copy(e),this.constant=-t.dot(this.normal),this}setFromCoplanarPoints(e,t,i){const r=Fl.subVectors(i,t).cross(O0.subVectors(e,t)).normalize();return this.setFromNormalAndCoplanarPoint(r,e),this}copy(e){return this.normal.copy(e.normal),this.constant=e.constant,this}normalize(){const e=1/this.normal.length();return this.normal.multiplyScalar(e),this.constant*=e,this}negate(){return this.constant*=-1,this.normal.negate(),this}distanceToPoint(e){return this.normal.dot(e)+this.constant}distanceToSphere(e){return this.distanceToPoint(e.center)-e.radius}projectPoint(e,t){return t.copy(e).addScaledVector(this.normal,-this.distanceToPoint(e))}intersectLine(e,t){const i=e.delta(Fl),r=this.normal.dot(i);if(r===0)return this.distanceToPoint(e.start)===0?t.copy(e.start):null;const s=-(e.start.dot(this.normal)+this.constant)/r;return s<0||s>1?null:t.copy(e.start).addScaledVector(i,s)}intersectsLine(e){const t=this.distanceToPoint(e.start),i=this.distanceToPoint(e.end);return t<0&&i>0||i<0&&t>0}intersectsBox(e){return e.intersectsPlane(this)}intersectsSphere(e){return e.intersectsPlane(this)}coplanarPoint(e){return e.copy(this.normal).multiplyScalar(-this.constant)}applyMatrix4(e,t){const i=t||B0.getNormalMatrix(e),r=this.coplanarPoint(Fl).applyMatrix4(e),s=this.normal.applyMatrix3(i).normalize();return this.constant=-r.dot(s),this}translate(e){return this.constant-=e.dot(this.normal),this}equals(e){return e.normal.equals(this.normal)&&e.constant===this.constant}clone(){return new this.constructor().copy(this)}}const fr=new As,qo=new z;class fp{constructor(e=new ri,t=new ri,i=new ri,r=new ri,s=new ri,o=new ri){this.planes=[e,t,i,r,s,o]}set(e,t,i,r,s,o){const a=this.planes;return a[0].copy(e),a[1].copy(t),a[2].copy(i),a[3].copy(r),a[4].copy(s),a[5].copy(o),this}copy(e){const t=this.planes;for(let i=0;i<6;i++)t[i].copy(e.planes[i]);return this}setFromProjectionMatrix(e,t=Ci){const i=this.planes,r=e.elements,s=r[0],o=r[1],a=r[2],l=r[3],c=r[4],u=r[5],d=r[6],h=r[7],f=r[8],_=r[9],v=r[10],g=r[11],m=r[12],y=r[13],S=r[14],M=r[15];if(i[0].setComponents(l-s,h-c,g-f,M-m).normalize(),i[1].setComponents(l+s,h+c,g+f,M+m).normalize(),i[2].setComponents(l+o,h+u,g+_,M+y).normalize(),i[3].setComponents(l-o,h-u,g-_,M-y).normalize(),i[4].setComponents(l-a,h-d,g-v,M-S).normalize(),t===Ci)i[5].setComponents(l+a,h+d,g+v,M+S).normalize();else if(t===Fa)i[5].setComponents(a,d,v,S).normalize();else throw new Error("THREE.Frustum.setFromProjectionMatrix(): Invalid coordinate system: "+t);return this}intersectsObject(e){if(e.boundingSphere!==void 0)e.boundingSphere===null&&e.computeBoundingSphere(),fr.copy(e.boundingSphere).applyMatrix4(e.matrixWorld);else{const t=e.geometry;t.boundingSphere===null&&t.computeBoundingSphere(),fr.copy(t.boundingSphere).applyMatrix4(e.matrixWorld)}return this.intersectsSphere(fr)}intersectsSprite(e){return fr.center.set(0,0,0),fr.radius=.7071067811865476,fr.applyMatrix4(e.matrixWorld),this.intersectsSphere(fr)}intersectsSphere(e){const t=this.planes,i=e.center,r=-e.radius;for(let s=0;s<6;s++)if(t[s].distanceToPoint(i)<r)return!1;return!0}intersectsBox(e){const t=this.planes;for(let i=0;i<6;i++){const r=t[i];if(qo.x=r.normal.x>0?e.max.x:e.min.x,qo.y=r.normal.y>0?e.max.y:e.min.y,qo.z=r.normal.z>0?e.max.z:e.min.z,r.distanceToPoint(qo)<0)return!1}return!0}containsPoint(e){const t=this.planes;for(let i=0;i<6;i++)if(t[i].distanceToPoint(e)<0)return!1;return!0}clone(){return new this.constructor().copy(this)}}function pp(){let n=null,e=!1,t=null,i=null;function r(s,o){t(s,o),i=n.requestAnimationFrame(r)}return{start:function(){e!==!0&&t!==null&&(i=n.requestAnimationFrame(r),e=!0)},stop:function(){n.cancelAnimationFrame(i),e=!1},setAnimationLoop:function(s){t=s},setContext:function(s){n=s}}}function k0(n){const e=new WeakMap;function t(a,l){const c=a.array,u=a.usage,d=c.byteLength,h=n.createBuffer();n.bindBuffer(l,h),n.bufferData(l,c,u),a.onUploadCallback();let f;if(c instanceof Float32Array)f=n.FLOAT;else if(c instanceof Uint16Array)a.isFloat16BufferAttribute?f=n.HALF_FLOAT:f=n.UNSIGNED_SHORT;else if(c instanceof Int16Array)f=n.SHORT;else if(c instanceof Uint32Array)f=n.UNSIGNED_INT;else if(c instanceof Int32Array)f=n.INT;else if(c instanceof Int8Array)f=n.BYTE;else if(c instanceof Uint8Array)f=n.UNSIGNED_BYTE;else if(c instanceof Uint8ClampedArray)f=n.UNSIGNED_BYTE;else throw new Error("THREE.WebGLAttributes: Unsupported buffer data format: "+c);return{buffer:h,type:f,bytesPerElement:c.BYTES_PER_ELEMENT,version:a.version,size:d}}function i(a,l,c){const u=l.array,d=l.updateRanges;if(n.bindBuffer(c,a),d.length===0)n.bufferSubData(c,0,u);else{d.sort((f,_)=>f.start-_.start);let h=0;for(let f=1;f<d.length;f++){const _=d[h],v=d[f];v.start<=_.start+_.count+1?_.count=Math.max(_.count,v.start+v.count-_.start):(++h,d[h]=v)}d.length=h+1;for(let f=0,_=d.length;f<_;f++){const v=d[f];n.bufferSubData(c,v.start*u.BYTES_PER_ELEMENT,u,v.start,v.count)}l.clearUpdateRanges()}l.onUploadCallback()}function r(a){return a.isInterleavedBufferAttribute&&(a=a.data),e.get(a)}function s(a){a.isInterleavedBufferAttribute&&(a=a.data);const l=e.get(a);l&&(n.deleteBuffer(l.buffer),e.delete(a))}function o(a,l){if(a.isInterleavedBufferAttribute&&(a=a.data),a.isGLBufferAttribute){const u=e.get(a);(!u||u.version<a.version)&&e.set(a,{buffer:a.buffer,type:a.type,bytesPerElement:a.elementSize,version:a.version});return}const c=e.get(a);if(c===void 0)e.set(a,t(a,l));else if(c.version<a.version){if(c.size!==a.array.byteLength)throw new Error("THREE.WebGLAttributes: The size of the buffer attribute's array buffer does not match the original size. Resizing buffer attributes is not supported.");i(c.buffer,a,l),c.version=a.version}}return{get:r,remove:s,update:o}}class $a extends Ct{constructor(e=1,t=1,i=1,r=1){super(),this.type="PlaneGeometry",this.parameters={width:e,height:t,widthSegments:i,heightSegments:r};const s=e/2,o=t/2,a=Math.floor(i),l=Math.floor(r),c=a+1,u=l+1,d=e/a,h=t/l,f=[],_=[],v=[],g=[];for(let m=0;m<u;m++){const y=m*h-o;for(let S=0;S<c;S++){const M=S*d-s;_.push(M,-y,0),v.push(0,0,1),g.push(S/a),g.push(1-m/l)}}for(let m=0;m<l;m++)for(let y=0;y<a;y++){const S=y+c*m,M=y+c*(m+1),R=y+1+c*(m+1),A=y+1+c*m;f.push(S,M,A),f.push(M,R,A)}this.setIndex(f),this.setAttribute("position",new Ft(_,3)),this.setAttribute("normal",new Ft(v,3)),this.setAttribute("uv",new Ft(g,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new $a(e.width,e.height,e.widthSegments,e.heightSegments)}}var z0=`#ifdef USE_ALPHAHASH
	if ( diffuseColor.a < getAlphaHashThreshold( vPosition ) ) discard;
#endif`,H0=`#ifdef USE_ALPHAHASH
	const float ALPHA_HASH_SCALE = 0.05;
	float hash2D( vec2 value ) {
		return fract( 1.0e4 * sin( 17.0 * value.x + 0.1 * value.y ) * ( 0.1 + abs( sin( 13.0 * value.y + value.x ) ) ) );
	}
	float hash3D( vec3 value ) {
		return hash2D( vec2( hash2D( value.xy ), value.z ) );
	}
	float getAlphaHashThreshold( vec3 position ) {
		float maxDeriv = max(
			length( dFdx( position.xyz ) ),
			length( dFdy( position.xyz ) )
		);
		float pixScale = 1.0 / ( ALPHA_HASH_SCALE * maxDeriv );
		vec2 pixScales = vec2(
			exp2( floor( log2( pixScale ) ) ),
			exp2( ceil( log2( pixScale ) ) )
		);
		vec2 alpha = vec2(
			hash3D( floor( pixScales.x * position.xyz ) ),
			hash3D( floor( pixScales.y * position.xyz ) )
		);
		float lerpFactor = fract( log2( pixScale ) );
		float x = ( 1.0 - lerpFactor ) * alpha.x + lerpFactor * alpha.y;
		float a = min( lerpFactor, 1.0 - lerpFactor );
		vec3 cases = vec3(
			x * x / ( 2.0 * a * ( 1.0 - a ) ),
			( x - 0.5 * a ) / ( 1.0 - a ),
			1.0 - ( ( 1.0 - x ) * ( 1.0 - x ) / ( 2.0 * a * ( 1.0 - a ) ) )
		);
		float threshold = ( x < ( 1.0 - a ) )
			? ( ( x < a ) ? cases.x : cases.y )
			: cases.z;
		return clamp( threshold , 1.0e-6, 1.0 );
	}
#endif`,V0=`#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, vAlphaMapUv ).g;
#endif`,G0=`#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,W0=`#ifdef USE_ALPHATEST
	#ifdef ALPHA_TO_COVERAGE
	diffuseColor.a = smoothstep( alphaTest, alphaTest + fwidth( diffuseColor.a ), diffuseColor.a );
	if ( diffuseColor.a == 0.0 ) discard;
	#else
	if ( diffuseColor.a < alphaTest ) discard;
	#endif
#endif`,$0=`#ifdef USE_ALPHATEST
	uniform float alphaTest;
#endif`,X0=`#ifdef USE_AOMAP
	float ambientOcclusion = ( texture2D( aoMap, vAoMapUv ).r - 1.0 ) * aoMapIntensity + 1.0;
	reflectedLight.indirectDiffuse *= ambientOcclusion;
	#if defined( USE_CLEARCOAT ) 
		clearcoatSpecularIndirect *= ambientOcclusion;
	#endif
	#if defined( USE_SHEEN ) 
		sheenSpecularIndirect *= ambientOcclusion;
	#endif
	#if defined( USE_ENVMAP ) && defined( STANDARD )
		float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
		reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );
	#endif
#endif`,j0=`#ifdef USE_AOMAP
	uniform sampler2D aoMap;
	uniform float aoMapIntensity;
#endif`,q0=`#ifdef USE_BATCHING
	#if ! defined( GL_ANGLE_multi_draw )
	#define gl_DrawID _gl_DrawID
	uniform int _gl_DrawID;
	#endif
	uniform highp sampler2D batchingTexture;
	uniform highp usampler2D batchingIdTexture;
	mat4 getBatchingMatrix( const in float i ) {
		int size = textureSize( batchingTexture, 0 ).x;
		int j = int( i ) * 4;
		int x = j % size;
		int y = j / size;
		vec4 v1 = texelFetch( batchingTexture, ivec2( x, y ), 0 );
		vec4 v2 = texelFetch( batchingTexture, ivec2( x + 1, y ), 0 );
		vec4 v3 = texelFetch( batchingTexture, ivec2( x + 2, y ), 0 );
		vec4 v4 = texelFetch( batchingTexture, ivec2( x + 3, y ), 0 );
		return mat4( v1, v2, v3, v4 );
	}
	float getIndirectIndex( const in int i ) {
		int size = textureSize( batchingIdTexture, 0 ).x;
		int x = i % size;
		int y = i / size;
		return float( texelFetch( batchingIdTexture, ivec2( x, y ), 0 ).r );
	}
#endif
#ifdef USE_BATCHING_COLOR
	uniform sampler2D batchingColorTexture;
	vec3 getBatchingColor( const in float i ) {
		int size = textureSize( batchingColorTexture, 0 ).x;
		int j = int( i );
		int x = j % size;
		int y = j / size;
		return texelFetch( batchingColorTexture, ivec2( x, y ), 0 ).rgb;
	}
#endif`,Y0=`#ifdef USE_BATCHING
	mat4 batchingMatrix = getBatchingMatrix( getIndirectIndex( gl_DrawID ) );
#endif`,Z0=`vec3 transformed = vec3( position );
#ifdef USE_ALPHAHASH
	vPosition = vec3( position );
#endif`,K0=`vec3 objectNormal = vec3( normal );
#ifdef USE_TANGENT
	vec3 objectTangent = vec3( tangent.xyz );
#endif`,J0=`float G_BlinnPhong_Implicit( ) {
	return 0.25;
}
float D_BlinnPhong( const in float shininess, const in float dotNH ) {
	return RECIPROCAL_PI * ( shininess * 0.5 + 1.0 ) * pow( dotNH, shininess );
}
vec3 BRDF_BlinnPhong( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in vec3 specularColor, const in float shininess ) {
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNH = saturate( dot( normal, halfDir ) );
	float dotVH = saturate( dot( viewDir, halfDir ) );
	vec3 F = F_Schlick( specularColor, 1.0, dotVH );
	float G = G_BlinnPhong_Implicit( );
	float D = D_BlinnPhong( shininess, dotNH );
	return F * ( G * D );
} // validated`,Q0=`#ifdef USE_IRIDESCENCE
	const mat3 XYZ_TO_REC709 = mat3(
		 3.2404542, -0.9692660,  0.0556434,
		-1.5371385,  1.8760108, -0.2040259,
		-0.4985314,  0.0415560,  1.0572252
	);
	vec3 Fresnel0ToIor( vec3 fresnel0 ) {
		vec3 sqrtF0 = sqrt( fresnel0 );
		return ( vec3( 1.0 ) + sqrtF0 ) / ( vec3( 1.0 ) - sqrtF0 );
	}
	vec3 IorToFresnel0( vec3 transmittedIor, float incidentIor ) {
		return pow2( ( transmittedIor - vec3( incidentIor ) ) / ( transmittedIor + vec3( incidentIor ) ) );
	}
	float IorToFresnel0( float transmittedIor, float incidentIor ) {
		return pow2( ( transmittedIor - incidentIor ) / ( transmittedIor + incidentIor ));
	}
	vec3 evalSensitivity( float OPD, vec3 shift ) {
		float phase = 2.0 * PI * OPD * 1.0e-9;
		vec3 val = vec3( 5.4856e-13, 4.4201e-13, 5.2481e-13 );
		vec3 pos = vec3( 1.6810e+06, 1.7953e+06, 2.2084e+06 );
		vec3 var = vec3( 4.3278e+09, 9.3046e+09, 6.6121e+09 );
		vec3 xyz = val * sqrt( 2.0 * PI * var ) * cos( pos * phase + shift ) * exp( - pow2( phase ) * var );
		xyz.x += 9.7470e-14 * sqrt( 2.0 * PI * 4.5282e+09 ) * cos( 2.2399e+06 * phase + shift[ 0 ] ) * exp( - 4.5282e+09 * pow2( phase ) );
		xyz /= 1.0685e-7;
		vec3 rgb = XYZ_TO_REC709 * xyz;
		return rgb;
	}
	vec3 evalIridescence( float outsideIOR, float eta2, float cosTheta1, float thinFilmThickness, vec3 baseF0 ) {
		vec3 I;
		float iridescenceIOR = mix( outsideIOR, eta2, smoothstep( 0.0, 0.03, thinFilmThickness ) );
		float sinTheta2Sq = pow2( outsideIOR / iridescenceIOR ) * ( 1.0 - pow2( cosTheta1 ) );
		float cosTheta2Sq = 1.0 - sinTheta2Sq;
		if ( cosTheta2Sq < 0.0 ) {
			return vec3( 1.0 );
		}
		float cosTheta2 = sqrt( cosTheta2Sq );
		float R0 = IorToFresnel0( iridescenceIOR, outsideIOR );
		float R12 = F_Schlick( R0, 1.0, cosTheta1 );
		float T121 = 1.0 - R12;
		float phi12 = 0.0;
		if ( iridescenceIOR < outsideIOR ) phi12 = PI;
		float phi21 = PI - phi12;
		vec3 baseIOR = Fresnel0ToIor( clamp( baseF0, 0.0, 0.9999 ) );		vec3 R1 = IorToFresnel0( baseIOR, iridescenceIOR );
		vec3 R23 = F_Schlick( R1, 1.0, cosTheta2 );
		vec3 phi23 = vec3( 0.0 );
		if ( baseIOR[ 0 ] < iridescenceIOR ) phi23[ 0 ] = PI;
		if ( baseIOR[ 1 ] < iridescenceIOR ) phi23[ 1 ] = PI;
		if ( baseIOR[ 2 ] < iridescenceIOR ) phi23[ 2 ] = PI;
		float OPD = 2.0 * iridescenceIOR * thinFilmThickness * cosTheta2;
		vec3 phi = vec3( phi21 ) + phi23;
		vec3 R123 = clamp( R12 * R23, 1e-5, 0.9999 );
		vec3 r123 = sqrt( R123 );
		vec3 Rs = pow2( T121 ) * R23 / ( vec3( 1.0 ) - R123 );
		vec3 C0 = R12 + Rs;
		I = C0;
		vec3 Cm = Rs - T121;
		for ( int m = 1; m <= 2; ++ m ) {
			Cm *= r123;
			vec3 Sm = 2.0 * evalSensitivity( float( m ) * OPD, float( m ) * phi );
			I += Cm * Sm;
		}
		return max( I, vec3( 0.0 ) );
	}
#endif`,e_=`#ifdef USE_BUMPMAP
	uniform sampler2D bumpMap;
	uniform float bumpScale;
	vec2 dHdxy_fwd() {
		vec2 dSTdx = dFdx( vBumpMapUv );
		vec2 dSTdy = dFdy( vBumpMapUv );
		float Hll = bumpScale * texture2D( bumpMap, vBumpMapUv ).x;
		float dBx = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdx ).x - Hll;
		float dBy = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdy ).x - Hll;
		return vec2( dBx, dBy );
	}
	vec3 perturbNormalArb( vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection ) {
		vec3 vSigmaX = normalize( dFdx( surf_pos.xyz ) );
		vec3 vSigmaY = normalize( dFdy( surf_pos.xyz ) );
		vec3 vN = surf_norm;
		vec3 R1 = cross( vSigmaY, vN );
		vec3 R2 = cross( vN, vSigmaX );
		float fDet = dot( vSigmaX, R1 ) * faceDirection;
		vec3 vGrad = sign( fDet ) * ( dHdxy.x * R1 + dHdxy.y * R2 );
		return normalize( abs( fDet ) * surf_norm - vGrad );
	}
#endif`,t_=`#if NUM_CLIPPING_PLANES > 0
	vec4 plane;
	#ifdef ALPHA_TO_COVERAGE
		float distanceToPlane, distanceGradient;
		float clipOpacity = 1.0;
		#pragma unroll_loop_start
		for ( int i = 0; i < UNION_CLIPPING_PLANES; i ++ ) {
			plane = clippingPlanes[ i ];
			distanceToPlane = - dot( vClipPosition, plane.xyz ) + plane.w;
			distanceGradient = fwidth( distanceToPlane ) / 2.0;
			clipOpacity *= smoothstep( - distanceGradient, distanceGradient, distanceToPlane );
			if ( clipOpacity == 0.0 ) discard;
		}
		#pragma unroll_loop_end
		#if UNION_CLIPPING_PLANES < NUM_CLIPPING_PLANES
			float unionClipOpacity = 1.0;
			#pragma unroll_loop_start
			for ( int i = UNION_CLIPPING_PLANES; i < NUM_CLIPPING_PLANES; i ++ ) {
				plane = clippingPlanes[ i ];
				distanceToPlane = - dot( vClipPosition, plane.xyz ) + plane.w;
				distanceGradient = fwidth( distanceToPlane ) / 2.0;
				unionClipOpacity *= 1.0 - smoothstep( - distanceGradient, distanceGradient, distanceToPlane );
			}
			#pragma unroll_loop_end
			clipOpacity *= 1.0 - unionClipOpacity;
		#endif
		diffuseColor.a *= clipOpacity;
		if ( diffuseColor.a == 0.0 ) discard;
	#else
		#pragma unroll_loop_start
		for ( int i = 0; i < UNION_CLIPPING_PLANES; i ++ ) {
			plane = clippingPlanes[ i ];
			if ( dot( vClipPosition, plane.xyz ) > plane.w ) discard;
		}
		#pragma unroll_loop_end
		#if UNION_CLIPPING_PLANES < NUM_CLIPPING_PLANES
			bool clipped = true;
			#pragma unroll_loop_start
			for ( int i = UNION_CLIPPING_PLANES; i < NUM_CLIPPING_PLANES; i ++ ) {
				plane = clippingPlanes[ i ];
				clipped = ( dot( vClipPosition, plane.xyz ) > plane.w ) && clipped;
			}
			#pragma unroll_loop_end
			if ( clipped ) discard;
		#endif
	#endif
#endif`,n_=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
	uniform vec4 clippingPlanes[ NUM_CLIPPING_PLANES ];
#endif`,i_=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
#endif`,r_=`#if NUM_CLIPPING_PLANES > 0
	vClipPosition = - mvPosition.xyz;
#endif`,s_=`#if defined( USE_COLOR_ALPHA )
	diffuseColor *= vColor;
#elif defined( USE_COLOR )
	diffuseColor.rgb *= vColor;
#endif`,o_=`#if defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#elif defined( USE_COLOR )
	varying vec3 vColor;
#endif`,a_=`#if defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#elif defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	varying vec3 vColor;
#endif`,l_=`#if defined( USE_COLOR_ALPHA )
	vColor = vec4( 1.0 );
#elif defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	vColor = vec3( 1.0 );
#endif
#ifdef USE_COLOR
	vColor *= color;
#endif
#ifdef USE_INSTANCING_COLOR
	vColor.xyz *= instanceColor.xyz;
#endif
#ifdef USE_BATCHING_COLOR
	vec3 batchingColor = getBatchingColor( getIndirectIndex( gl_DrawID ) );
	vColor.xyz *= batchingColor.xyz;
#endif`,c_=`#define PI 3.141592653589793
#define PI2 6.283185307179586
#define PI_HALF 1.5707963267948966
#define RECIPROCAL_PI 0.3183098861837907
#define RECIPROCAL_PI2 0.15915494309189535
#define EPSILON 1e-6
#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
#define whiteComplement( a ) ( 1.0 - saturate( a ) )
float pow2( const in float x ) { return x*x; }
vec3 pow2( const in vec3 x ) { return x*x; }
float pow3( const in float x ) { return x*x*x; }
float pow4( const in float x ) { float x2 = x*x; return x2*x2; }
float max3( const in vec3 v ) { return max( max( v.x, v.y ), v.z ); }
float average( const in vec3 v ) { return dot( v, vec3( 0.3333333 ) ); }
highp float rand( const in vec2 uv ) {
	const highp float a = 12.9898, b = 78.233, c = 43758.5453;
	highp float dt = dot( uv.xy, vec2( a,b ) ), sn = mod( dt, PI );
	return fract( sin( sn ) * c );
}
#ifdef HIGH_PRECISION
	float precisionSafeLength( vec3 v ) { return length( v ); }
#else
	float precisionSafeLength( vec3 v ) {
		float maxComponent = max3( abs( v ) );
		return length( v / maxComponent ) * maxComponent;
	}
#endif
struct IncidentLight {
	vec3 color;
	vec3 direction;
	bool visible;
};
struct ReflectedLight {
	vec3 directDiffuse;
	vec3 directSpecular;
	vec3 indirectDiffuse;
	vec3 indirectSpecular;
};
#ifdef USE_ALPHAHASH
	varying vec3 vPosition;
#endif
vec3 transformDirection( in vec3 dir, in mat4 matrix ) {
	return normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );
}
vec3 inverseTransformDirection( in vec3 dir, in mat4 matrix ) {
	return normalize( ( vec4( dir, 0.0 ) * matrix ).xyz );
}
mat3 transposeMat3( const in mat3 m ) {
	mat3 tmp;
	tmp[ 0 ] = vec3( m[ 0 ].x, m[ 1 ].x, m[ 2 ].x );
	tmp[ 1 ] = vec3( m[ 0 ].y, m[ 1 ].y, m[ 2 ].y );
	tmp[ 2 ] = vec3( m[ 0 ].z, m[ 1 ].z, m[ 2 ].z );
	return tmp;
}
bool isPerspectiveMatrix( mat4 m ) {
	return m[ 2 ][ 3 ] == - 1.0;
}
vec2 equirectUv( in vec3 dir ) {
	float u = atan( dir.z, dir.x ) * RECIPROCAL_PI2 + 0.5;
	float v = asin( clamp( dir.y, - 1.0, 1.0 ) ) * RECIPROCAL_PI + 0.5;
	return vec2( u, v );
}
vec3 BRDF_Lambert( const in vec3 diffuseColor ) {
	return RECIPROCAL_PI * diffuseColor;
}
vec3 F_Schlick( const in vec3 f0, const in float f90, const in float dotVH ) {
	float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
	return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
}
float F_Schlick( const in float f0, const in float f90, const in float dotVH ) {
	float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
	return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
} // validated`,u_=`#ifdef ENVMAP_TYPE_CUBE_UV
	#define cubeUV_minMipLevel 4.0
	#define cubeUV_minTileSize 16.0
	float getFace( vec3 direction ) {
		vec3 absDirection = abs( direction );
		float face = - 1.0;
		if ( absDirection.x > absDirection.z ) {
			if ( absDirection.x > absDirection.y )
				face = direction.x > 0.0 ? 0.0 : 3.0;
			else
				face = direction.y > 0.0 ? 1.0 : 4.0;
		} else {
			if ( absDirection.z > absDirection.y )
				face = direction.z > 0.0 ? 2.0 : 5.0;
			else
				face = direction.y > 0.0 ? 1.0 : 4.0;
		}
		return face;
	}
	vec2 getUV( vec3 direction, float face ) {
		vec2 uv;
		if ( face == 0.0 ) {
			uv = vec2( direction.z, direction.y ) / abs( direction.x );
		} else if ( face == 1.0 ) {
			uv = vec2( - direction.x, - direction.z ) / abs( direction.y );
		} else if ( face == 2.0 ) {
			uv = vec2( - direction.x, direction.y ) / abs( direction.z );
		} else if ( face == 3.0 ) {
			uv = vec2( - direction.z, direction.y ) / abs( direction.x );
		} else if ( face == 4.0 ) {
			uv = vec2( - direction.x, direction.z ) / abs( direction.y );
		} else {
			uv = vec2( direction.x, direction.y ) / abs( direction.z );
		}
		return 0.5 * ( uv + 1.0 );
	}
	vec3 bilinearCubeUV( sampler2D envMap, vec3 direction, float mipInt ) {
		float face = getFace( direction );
		float filterInt = max( cubeUV_minMipLevel - mipInt, 0.0 );
		mipInt = max( mipInt, cubeUV_minMipLevel );
		float faceSize = exp2( mipInt );
		highp vec2 uv = getUV( direction, face ) * ( faceSize - 2.0 ) + 1.0;
		if ( face > 2.0 ) {
			uv.y += faceSize;
			face -= 3.0;
		}
		uv.x += face * faceSize;
		uv.x += filterInt * 3.0 * cubeUV_minTileSize;
		uv.y += 4.0 * ( exp2( CUBEUV_MAX_MIP ) - faceSize );
		uv.x *= CUBEUV_TEXEL_WIDTH;
		uv.y *= CUBEUV_TEXEL_HEIGHT;
		#ifdef texture2DGradEXT
			return texture2DGradEXT( envMap, uv, vec2( 0.0 ), vec2( 0.0 ) ).rgb;
		#else
			return texture2D( envMap, uv ).rgb;
		#endif
	}
	#define cubeUV_r0 1.0
	#define cubeUV_m0 - 2.0
	#define cubeUV_r1 0.8
	#define cubeUV_m1 - 1.0
	#define cubeUV_r4 0.4
	#define cubeUV_m4 2.0
	#define cubeUV_r5 0.305
	#define cubeUV_m5 3.0
	#define cubeUV_r6 0.21
	#define cubeUV_m6 4.0
	float roughnessToMip( float roughness ) {
		float mip = 0.0;
		if ( roughness >= cubeUV_r1 ) {
			mip = ( cubeUV_r0 - roughness ) * ( cubeUV_m1 - cubeUV_m0 ) / ( cubeUV_r0 - cubeUV_r1 ) + cubeUV_m0;
		} else if ( roughness >= cubeUV_r4 ) {
			mip = ( cubeUV_r1 - roughness ) * ( cubeUV_m4 - cubeUV_m1 ) / ( cubeUV_r1 - cubeUV_r4 ) + cubeUV_m1;
		} else if ( roughness >= cubeUV_r5 ) {
			mip = ( cubeUV_r4 - roughness ) * ( cubeUV_m5 - cubeUV_m4 ) / ( cubeUV_r4 - cubeUV_r5 ) + cubeUV_m4;
		} else if ( roughness >= cubeUV_r6 ) {
			mip = ( cubeUV_r5 - roughness ) * ( cubeUV_m6 - cubeUV_m5 ) / ( cubeUV_r5 - cubeUV_r6 ) + cubeUV_m5;
		} else {
			mip = - 2.0 * log2( 1.16 * roughness );		}
		return mip;
	}
	vec4 textureCubeUV( sampler2D envMap, vec3 sampleDir, float roughness ) {
		float mip = clamp( roughnessToMip( roughness ), cubeUV_m0, CUBEUV_MAX_MIP );
		float mipF = fract( mip );
		float mipInt = floor( mip );
		vec3 color0 = bilinearCubeUV( envMap, sampleDir, mipInt );
		if ( mipF == 0.0 ) {
			return vec4( color0, 1.0 );
		} else {
			vec3 color1 = bilinearCubeUV( envMap, sampleDir, mipInt + 1.0 );
			return vec4( mix( color0, color1, mipF ), 1.0 );
		}
	}
#endif`,d_=`vec3 transformedNormal = objectNormal;
#ifdef USE_TANGENT
	vec3 transformedTangent = objectTangent;
#endif
#ifdef USE_BATCHING
	mat3 bm = mat3( batchingMatrix );
	transformedNormal /= vec3( dot( bm[ 0 ], bm[ 0 ] ), dot( bm[ 1 ], bm[ 1 ] ), dot( bm[ 2 ], bm[ 2 ] ) );
	transformedNormal = bm * transformedNormal;
	#ifdef USE_TANGENT
		transformedTangent = bm * transformedTangent;
	#endif
#endif
#ifdef USE_INSTANCING
	mat3 im = mat3( instanceMatrix );
	transformedNormal /= vec3( dot( im[ 0 ], im[ 0 ] ), dot( im[ 1 ], im[ 1 ] ), dot( im[ 2 ], im[ 2 ] ) );
	transformedNormal = im * transformedNormal;
	#ifdef USE_TANGENT
		transformedTangent = im * transformedTangent;
	#endif
#endif
transformedNormal = normalMatrix * transformedNormal;
#ifdef FLIP_SIDED
	transformedNormal = - transformedNormal;
#endif
#ifdef USE_TANGENT
	transformedTangent = ( modelViewMatrix * vec4( transformedTangent, 0.0 ) ).xyz;
	#ifdef FLIP_SIDED
		transformedTangent = - transformedTangent;
	#endif
#endif`,h_=`#ifdef USE_DISPLACEMENTMAP
	uniform sampler2D displacementMap;
	uniform float displacementScale;
	uniform float displacementBias;
#endif`,f_=`#ifdef USE_DISPLACEMENTMAP
	transformed += normalize( objectNormal ) * ( texture2D( displacementMap, vDisplacementMapUv ).x * displacementScale + displacementBias );
#endif`,p_=`#ifdef USE_EMISSIVEMAP
	vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );
	totalEmissiveRadiance *= emissiveColor.rgb;
#endif`,m_=`#ifdef USE_EMISSIVEMAP
	uniform sampler2D emissiveMap;
#endif`,g_="gl_FragColor = linearToOutputTexel( gl_FragColor );",__=`
const mat3 LINEAR_SRGB_TO_LINEAR_DISPLAY_P3 = mat3(
	vec3( 0.8224621, 0.177538, 0.0 ),
	vec3( 0.0331941, 0.9668058, 0.0 ),
	vec3( 0.0170827, 0.0723974, 0.9105199 )
);
const mat3 LINEAR_DISPLAY_P3_TO_LINEAR_SRGB = mat3(
	vec3( 1.2249401, - 0.2249404, 0.0 ),
	vec3( - 0.0420569, 1.0420571, 0.0 ),
	vec3( - 0.0196376, - 0.0786361, 1.0982735 )
);
vec4 LinearSRGBToLinearDisplayP3( in vec4 value ) {
	return vec4( value.rgb * LINEAR_SRGB_TO_LINEAR_DISPLAY_P3, value.a );
}
vec4 LinearDisplayP3ToLinearSRGB( in vec4 value ) {
	return vec4( value.rgb * LINEAR_DISPLAY_P3_TO_LINEAR_SRGB, value.a );
}
vec4 LinearTransferOETF( in vec4 value ) {
	return value;
}
vec4 sRGBTransferOETF( in vec4 value ) {
	return vec4( mix( pow( value.rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), value.rgb * 12.92, vec3( lessThanEqual( value.rgb, vec3( 0.0031308 ) ) ) ), value.a );
}`,v_=`#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vec3 cameraToFrag;
		if ( isOrthographic ) {
			cameraToFrag = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToFrag = normalize( vWorldPosition - cameraPosition );
		}
		vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vec3 reflectVec = reflect( cameraToFrag, worldNormal );
		#else
			vec3 reflectVec = refract( cameraToFrag, worldNormal, refractionRatio );
		#endif
	#else
		vec3 reflectVec = vReflect;
	#endif
	#ifdef ENVMAP_TYPE_CUBE
		vec4 envColor = textureCube( envMap, envMapRotation * vec3( flipEnvMap * reflectVec.x, reflectVec.yz ) );
	#else
		vec4 envColor = vec4( 0.0 );
	#endif
	#ifdef ENVMAP_BLENDING_MULTIPLY
		outgoingLight = mix( outgoingLight, outgoingLight * envColor.xyz, specularStrength * reflectivity );
	#elif defined( ENVMAP_BLENDING_MIX )
		outgoingLight = mix( outgoingLight, envColor.xyz, specularStrength * reflectivity );
	#elif defined( ENVMAP_BLENDING_ADD )
		outgoingLight += envColor.xyz * specularStrength * reflectivity;
	#endif
#endif`,y_=`#ifdef USE_ENVMAP
	uniform float envMapIntensity;
	uniform float flipEnvMap;
	uniform mat3 envMapRotation;
	#ifdef ENVMAP_TYPE_CUBE
		uniform samplerCube envMap;
	#else
		uniform sampler2D envMap;
	#endif
	
#endif`,x_=`#ifdef USE_ENVMAP
	uniform float reflectivity;
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		varying vec3 vWorldPosition;
		uniform float refractionRatio;
	#else
		varying vec3 vReflect;
	#endif
#endif`,b_=`#ifdef USE_ENVMAP
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		
		varying vec3 vWorldPosition;
	#else
		varying vec3 vReflect;
		uniform float refractionRatio;
	#endif
#endif`,S_=`#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vWorldPosition = worldPosition.xyz;
	#else
		vec3 cameraToVertex;
		if ( isOrthographic ) {
			cameraToVertex = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToVertex = normalize( worldPosition.xyz - cameraPosition );
		}
		vec3 worldNormal = inverseTransformDirection( transformedNormal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vReflect = reflect( cameraToVertex, worldNormal );
		#else
			vReflect = refract( cameraToVertex, worldNormal, refractionRatio );
		#endif
	#endif
#endif`,M_=`#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
#endif`,w_=`#ifdef USE_FOG
	varying float vFogDepth;
#endif`,E_=`#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`,T_=`#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif`,A_=`#ifdef USE_GRADIENTMAP
	uniform sampler2D gradientMap;
#endif
vec3 getGradientIrradiance( vec3 normal, vec3 lightDirection ) {
	float dotNL = dot( normal, lightDirection );
	vec2 coord = vec2( dotNL * 0.5 + 0.5, 0.0 );
	#ifdef USE_GRADIENTMAP
		return vec3( texture2D( gradientMap, coord ).r );
	#else
		vec2 fw = fwidth( coord ) * 0.5;
		return mix( vec3( 0.7 ), vec3( 1.0 ), smoothstep( 0.7 - fw.x, 0.7 + fw.x, coord.x ) );
	#endif
}`,C_=`#ifdef USE_LIGHTMAP
	uniform sampler2D lightMap;
	uniform float lightMapIntensity;
#endif`,P_=`LambertMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularStrength = specularStrength;`,R_=`varying vec3 vViewPosition;
struct LambertMaterial {
	vec3 diffuseColor;
	float specularStrength;
};
void RE_Direct_Lambert( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Lambert( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_Lambert
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Lambert`,L_=`uniform bool receiveShadow;
uniform vec3 ambientLightColor;
#if defined( USE_LIGHT_PROBES )
	uniform vec3 lightProbe[ 9 ];
#endif
vec3 shGetIrradianceAt( in vec3 normal, in vec3 shCoefficients[ 9 ] ) {
	float x = normal.x, y = normal.y, z = normal.z;
	vec3 result = shCoefficients[ 0 ] * 0.886227;
	result += shCoefficients[ 1 ] * 2.0 * 0.511664 * y;
	result += shCoefficients[ 2 ] * 2.0 * 0.511664 * z;
	result += shCoefficients[ 3 ] * 2.0 * 0.511664 * x;
	result += shCoefficients[ 4 ] * 2.0 * 0.429043 * x * y;
	result += shCoefficients[ 5 ] * 2.0 * 0.429043 * y * z;
	result += shCoefficients[ 6 ] * ( 0.743125 * z * z - 0.247708 );
	result += shCoefficients[ 7 ] * 2.0 * 0.429043 * x * z;
	result += shCoefficients[ 8 ] * 0.429043 * ( x * x - y * y );
	return result;
}
vec3 getLightProbeIrradiance( const in vec3 lightProbe[ 9 ], const in vec3 normal ) {
	vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );
	vec3 irradiance = shGetIrradianceAt( worldNormal, lightProbe );
	return irradiance;
}
vec3 getAmbientLightIrradiance( const in vec3 ambientLightColor ) {
	vec3 irradiance = ambientLightColor;
	return irradiance;
}
float getDistanceAttenuation( const in float lightDistance, const in float cutoffDistance, const in float decayExponent ) {
	float distanceFalloff = 1.0 / max( pow( lightDistance, decayExponent ), 0.01 );
	if ( cutoffDistance > 0.0 ) {
		distanceFalloff *= pow2( saturate( 1.0 - pow4( lightDistance / cutoffDistance ) ) );
	}
	return distanceFalloff;
}
float getSpotAttenuation( const in float coneCosine, const in float penumbraCosine, const in float angleCosine ) {
	return smoothstep( coneCosine, penumbraCosine, angleCosine );
}
#if NUM_DIR_LIGHTS > 0
	struct DirectionalLight {
		vec3 direction;
		vec3 color;
	};
	uniform DirectionalLight directionalLights[ NUM_DIR_LIGHTS ];
	void getDirectionalLightInfo( const in DirectionalLight directionalLight, out IncidentLight light ) {
		light.color = directionalLight.color;
		light.direction = directionalLight.direction;
		light.visible = true;
	}
#endif
#if NUM_POINT_LIGHTS > 0
	struct PointLight {
		vec3 position;
		vec3 color;
		float distance;
		float decay;
	};
	uniform PointLight pointLights[ NUM_POINT_LIGHTS ];
	void getPointLightInfo( const in PointLight pointLight, const in vec3 geometryPosition, out IncidentLight light ) {
		vec3 lVector = pointLight.position - geometryPosition;
		light.direction = normalize( lVector );
		float lightDistance = length( lVector );
		light.color = pointLight.color;
		light.color *= getDistanceAttenuation( lightDistance, pointLight.distance, pointLight.decay );
		light.visible = ( light.color != vec3( 0.0 ) );
	}
#endif
#if NUM_SPOT_LIGHTS > 0
	struct SpotLight {
		vec3 position;
		vec3 direction;
		vec3 color;
		float distance;
		float decay;
		float coneCos;
		float penumbraCos;
	};
	uniform SpotLight spotLights[ NUM_SPOT_LIGHTS ];
	void getSpotLightInfo( const in SpotLight spotLight, const in vec3 geometryPosition, out IncidentLight light ) {
		vec3 lVector = spotLight.position - geometryPosition;
		light.direction = normalize( lVector );
		float angleCos = dot( light.direction, spotLight.direction );
		float spotAttenuation = getSpotAttenuation( spotLight.coneCos, spotLight.penumbraCos, angleCos );
		if ( spotAttenuation > 0.0 ) {
			float lightDistance = length( lVector );
			light.color = spotLight.color * spotAttenuation;
			light.color *= getDistanceAttenuation( lightDistance, spotLight.distance, spotLight.decay );
			light.visible = ( light.color != vec3( 0.0 ) );
		} else {
			light.color = vec3( 0.0 );
			light.visible = false;
		}
	}
#endif
#if NUM_RECT_AREA_LIGHTS > 0
	struct RectAreaLight {
		vec3 color;
		vec3 position;
		vec3 halfWidth;
		vec3 halfHeight;
	};
	uniform sampler2D ltc_1;	uniform sampler2D ltc_2;
	uniform RectAreaLight rectAreaLights[ NUM_RECT_AREA_LIGHTS ];
#endif
#if NUM_HEMI_LIGHTS > 0
	struct HemisphereLight {
		vec3 direction;
		vec3 skyColor;
		vec3 groundColor;
	};
	uniform HemisphereLight hemisphereLights[ NUM_HEMI_LIGHTS ];
	vec3 getHemisphereLightIrradiance( const in HemisphereLight hemiLight, const in vec3 normal ) {
		float dotNL = dot( normal, hemiLight.direction );
		float hemiDiffuseWeight = 0.5 * dotNL + 0.5;
		vec3 irradiance = mix( hemiLight.groundColor, hemiLight.skyColor, hemiDiffuseWeight );
		return irradiance;
	}
#endif`,I_=`#ifdef USE_ENVMAP
	vec3 getIBLIrradiance( const in vec3 normal ) {
		#ifdef ENVMAP_TYPE_CUBE_UV
			vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );
			vec4 envMapColor = textureCubeUV( envMap, envMapRotation * worldNormal, 1.0 );
			return PI * envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	vec3 getIBLRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness ) {
		#ifdef ENVMAP_TYPE_CUBE_UV
			vec3 reflectVec = reflect( - viewDir, normal );
			reflectVec = normalize( mix( reflectVec, normal, roughness * roughness) );
			reflectVec = inverseTransformDirection( reflectVec, viewMatrix );
			vec4 envMapColor = textureCubeUV( envMap, envMapRotation * reflectVec, roughness );
			return envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	#ifdef USE_ANISOTROPY
		vec3 getIBLAnisotropyRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness, const in vec3 bitangent, const in float anisotropy ) {
			#ifdef ENVMAP_TYPE_CUBE_UV
				vec3 bentNormal = cross( bitangent, viewDir );
				bentNormal = normalize( cross( bentNormal, bitangent ) );
				bentNormal = normalize( mix( bentNormal, normal, pow2( pow2( 1.0 - anisotropy * ( 1.0 - roughness ) ) ) ) );
				return getIBLRadiance( viewDir, bentNormal, roughness );
			#else
				return vec3( 0.0 );
			#endif
		}
	#endif
#endif`,D_=`ToonMaterial material;
material.diffuseColor = diffuseColor.rgb;`,N_=`varying vec3 vViewPosition;
struct ToonMaterial {
	vec3 diffuseColor;
};
void RE_Direct_Toon( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
	vec3 irradiance = getGradientIrradiance( geometryNormal, directLight.direction ) * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Toon( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_Toon
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Toon`,U_=`BlinnPhongMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularColor = specular;
material.specularShininess = shininess;
material.specularStrength = specularStrength;`,F_=`varying vec3 vViewPosition;
struct BlinnPhongMaterial {
	vec3 diffuseColor;
	vec3 specularColor;
	float specularShininess;
	float specularStrength;
};
void RE_Direct_BlinnPhong( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
	reflectedLight.directSpecular += irradiance * BRDF_BlinnPhong( directLight.direction, geometryViewDir, geometryNormal, material.specularColor, material.specularShininess ) * material.specularStrength;
}
void RE_IndirectDiffuse_BlinnPhong( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_BlinnPhong
#define RE_IndirectDiffuse		RE_IndirectDiffuse_BlinnPhong`,O_=`PhysicalMaterial material;
material.diffuseColor = diffuseColor.rgb * ( 1.0 - metalnessFactor );
vec3 dxy = max( abs( dFdx( nonPerturbedNormal ) ), abs( dFdy( nonPerturbedNormal ) ) );
float geometryRoughness = max( max( dxy.x, dxy.y ), dxy.z );
material.roughness = max( roughnessFactor, 0.0525 );material.roughness += geometryRoughness;
material.roughness = min( material.roughness, 1.0 );
#ifdef IOR
	material.ior = ior;
	#ifdef USE_SPECULAR
		float specularIntensityFactor = specularIntensity;
		vec3 specularColorFactor = specularColor;
		#ifdef USE_SPECULAR_COLORMAP
			specularColorFactor *= texture2D( specularColorMap, vSpecularColorMapUv ).rgb;
		#endif
		#ifdef USE_SPECULAR_INTENSITYMAP
			specularIntensityFactor *= texture2D( specularIntensityMap, vSpecularIntensityMapUv ).a;
		#endif
		material.specularF90 = mix( specularIntensityFactor, 1.0, metalnessFactor );
	#else
		float specularIntensityFactor = 1.0;
		vec3 specularColorFactor = vec3( 1.0 );
		material.specularF90 = 1.0;
	#endif
	material.specularColor = mix( min( pow2( ( material.ior - 1.0 ) / ( material.ior + 1.0 ) ) * specularColorFactor, vec3( 1.0 ) ) * specularIntensityFactor, diffuseColor.rgb, metalnessFactor );
#else
	material.specularColor = mix( vec3( 0.04 ), diffuseColor.rgb, metalnessFactor );
	material.specularF90 = 1.0;
#endif
#ifdef USE_CLEARCOAT
	material.clearcoat = clearcoat;
	material.clearcoatRoughness = clearcoatRoughness;
	material.clearcoatF0 = vec3( 0.04 );
	material.clearcoatF90 = 1.0;
	#ifdef USE_CLEARCOATMAP
		material.clearcoat *= texture2D( clearcoatMap, vClearcoatMapUv ).x;
	#endif
	#ifdef USE_CLEARCOAT_ROUGHNESSMAP
		material.clearcoatRoughness *= texture2D( clearcoatRoughnessMap, vClearcoatRoughnessMapUv ).y;
	#endif
	material.clearcoat = saturate( material.clearcoat );	material.clearcoatRoughness = max( material.clearcoatRoughness, 0.0525 );
	material.clearcoatRoughness += geometryRoughness;
	material.clearcoatRoughness = min( material.clearcoatRoughness, 1.0 );
#endif
#ifdef USE_DISPERSION
	material.dispersion = dispersion;
#endif
#ifdef USE_IRIDESCENCE
	material.iridescence = iridescence;
	material.iridescenceIOR = iridescenceIOR;
	#ifdef USE_IRIDESCENCEMAP
		material.iridescence *= texture2D( iridescenceMap, vIridescenceMapUv ).r;
	#endif
	#ifdef USE_IRIDESCENCE_THICKNESSMAP
		material.iridescenceThickness = (iridescenceThicknessMaximum - iridescenceThicknessMinimum) * texture2D( iridescenceThicknessMap, vIridescenceThicknessMapUv ).g + iridescenceThicknessMinimum;
	#else
		material.iridescenceThickness = iridescenceThicknessMaximum;
	#endif
#endif
#ifdef USE_SHEEN
	material.sheenColor = sheenColor;
	#ifdef USE_SHEEN_COLORMAP
		material.sheenColor *= texture2D( sheenColorMap, vSheenColorMapUv ).rgb;
	#endif
	material.sheenRoughness = clamp( sheenRoughness, 0.07, 1.0 );
	#ifdef USE_SHEEN_ROUGHNESSMAP
		material.sheenRoughness *= texture2D( sheenRoughnessMap, vSheenRoughnessMapUv ).a;
	#endif
#endif
#ifdef USE_ANISOTROPY
	#ifdef USE_ANISOTROPYMAP
		mat2 anisotropyMat = mat2( anisotropyVector.x, anisotropyVector.y, - anisotropyVector.y, anisotropyVector.x );
		vec3 anisotropyPolar = texture2D( anisotropyMap, vAnisotropyMapUv ).rgb;
		vec2 anisotropyV = anisotropyMat * normalize( 2.0 * anisotropyPolar.rg - vec2( 1.0 ) ) * anisotropyPolar.b;
	#else
		vec2 anisotropyV = anisotropyVector;
	#endif
	material.anisotropy = length( anisotropyV );
	if( material.anisotropy == 0.0 ) {
		anisotropyV = vec2( 1.0, 0.0 );
	} else {
		anisotropyV /= material.anisotropy;
		material.anisotropy = saturate( material.anisotropy );
	}
	material.alphaT = mix( pow2( material.roughness ), 1.0, pow2( material.anisotropy ) );
	material.anisotropyT = tbn[ 0 ] * anisotropyV.x + tbn[ 1 ] * anisotropyV.y;
	material.anisotropyB = tbn[ 1 ] * anisotropyV.x - tbn[ 0 ] * anisotropyV.y;
#endif`,B_=`struct PhysicalMaterial {
	vec3 diffuseColor;
	float roughness;
	vec3 specularColor;
	float specularF90;
	float dispersion;
	#ifdef USE_CLEARCOAT
		float clearcoat;
		float clearcoatRoughness;
		vec3 clearcoatF0;
		float clearcoatF90;
	#endif
	#ifdef USE_IRIDESCENCE
		float iridescence;
		float iridescenceIOR;
		float iridescenceThickness;
		vec3 iridescenceFresnel;
		vec3 iridescenceF0;
	#endif
	#ifdef USE_SHEEN
		vec3 sheenColor;
		float sheenRoughness;
	#endif
	#ifdef IOR
		float ior;
	#endif
	#ifdef USE_TRANSMISSION
		float transmission;
		float transmissionAlpha;
		float thickness;
		float attenuationDistance;
		vec3 attenuationColor;
	#endif
	#ifdef USE_ANISOTROPY
		float anisotropy;
		float alphaT;
		vec3 anisotropyT;
		vec3 anisotropyB;
	#endif
};
vec3 clearcoatSpecularDirect = vec3( 0.0 );
vec3 clearcoatSpecularIndirect = vec3( 0.0 );
vec3 sheenSpecularDirect = vec3( 0.0 );
vec3 sheenSpecularIndirect = vec3(0.0 );
vec3 Schlick_to_F0( const in vec3 f, const in float f90, const in float dotVH ) {
    float x = clamp( 1.0 - dotVH, 0.0, 1.0 );
    float x2 = x * x;
    float x5 = clamp( x * x2 * x2, 0.0, 0.9999 );
    return ( f - vec3( f90 ) * x5 ) / ( 1.0 - x5 );
}
float V_GGX_SmithCorrelated( const in float alpha, const in float dotNL, const in float dotNV ) {
	float a2 = pow2( alpha );
	float gv = dotNL * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNV ) );
	float gl = dotNV * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNL ) );
	return 0.5 / max( gv + gl, EPSILON );
}
float D_GGX( const in float alpha, const in float dotNH ) {
	float a2 = pow2( alpha );
	float denom = pow2( dotNH ) * ( a2 - 1.0 ) + 1.0;
	return RECIPROCAL_PI * a2 / pow2( denom );
}
#ifdef USE_ANISOTROPY
	float V_GGX_SmithCorrelated_Anisotropic( const in float alphaT, const in float alphaB, const in float dotTV, const in float dotBV, const in float dotTL, const in float dotBL, const in float dotNV, const in float dotNL ) {
		float gv = dotNL * length( vec3( alphaT * dotTV, alphaB * dotBV, dotNV ) );
		float gl = dotNV * length( vec3( alphaT * dotTL, alphaB * dotBL, dotNL ) );
		float v = 0.5 / ( gv + gl );
		return saturate(v);
	}
	float D_GGX_Anisotropic( const in float alphaT, const in float alphaB, const in float dotNH, const in float dotTH, const in float dotBH ) {
		float a2 = alphaT * alphaB;
		highp vec3 v = vec3( alphaB * dotTH, alphaT * dotBH, a2 * dotNH );
		highp float v2 = dot( v, v );
		float w2 = a2 / v2;
		return RECIPROCAL_PI * a2 * pow2 ( w2 );
	}
#endif
#ifdef USE_CLEARCOAT
	vec3 BRDF_GGX_Clearcoat( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material) {
		vec3 f0 = material.clearcoatF0;
		float f90 = material.clearcoatF90;
		float roughness = material.clearcoatRoughness;
		float alpha = pow2( roughness );
		vec3 halfDir = normalize( lightDir + viewDir );
		float dotNL = saturate( dot( normal, lightDir ) );
		float dotNV = saturate( dot( normal, viewDir ) );
		float dotNH = saturate( dot( normal, halfDir ) );
		float dotVH = saturate( dot( viewDir, halfDir ) );
		vec3 F = F_Schlick( f0, f90, dotVH );
		float V = V_GGX_SmithCorrelated( alpha, dotNL, dotNV );
		float D = D_GGX( alpha, dotNH );
		return F * ( V * D );
	}
#endif
vec3 BRDF_GGX( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material ) {
	vec3 f0 = material.specularColor;
	float f90 = material.specularF90;
	float roughness = material.roughness;
	float alpha = pow2( roughness );
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	float dotNH = saturate( dot( normal, halfDir ) );
	float dotVH = saturate( dot( viewDir, halfDir ) );
	vec3 F = F_Schlick( f0, f90, dotVH );
	#ifdef USE_IRIDESCENCE
		F = mix( F, material.iridescenceFresnel, material.iridescence );
	#endif
	#ifdef USE_ANISOTROPY
		float dotTL = dot( material.anisotropyT, lightDir );
		float dotTV = dot( material.anisotropyT, viewDir );
		float dotTH = dot( material.anisotropyT, halfDir );
		float dotBL = dot( material.anisotropyB, lightDir );
		float dotBV = dot( material.anisotropyB, viewDir );
		float dotBH = dot( material.anisotropyB, halfDir );
		float V = V_GGX_SmithCorrelated_Anisotropic( material.alphaT, alpha, dotTV, dotBV, dotTL, dotBL, dotNV, dotNL );
		float D = D_GGX_Anisotropic( material.alphaT, alpha, dotNH, dotTH, dotBH );
	#else
		float V = V_GGX_SmithCorrelated( alpha, dotNL, dotNV );
		float D = D_GGX( alpha, dotNH );
	#endif
	return F * ( V * D );
}
vec2 LTC_Uv( const in vec3 N, const in vec3 V, const in float roughness ) {
	const float LUT_SIZE = 64.0;
	const float LUT_SCALE = ( LUT_SIZE - 1.0 ) / LUT_SIZE;
	const float LUT_BIAS = 0.5 / LUT_SIZE;
	float dotNV = saturate( dot( N, V ) );
	vec2 uv = vec2( roughness, sqrt( 1.0 - dotNV ) );
	uv = uv * LUT_SCALE + LUT_BIAS;
	return uv;
}
float LTC_ClippedSphereFormFactor( const in vec3 f ) {
	float l = length( f );
	return max( ( l * l + f.z ) / ( l + 1.0 ), 0.0 );
}
vec3 LTC_EdgeVectorFormFactor( const in vec3 v1, const in vec3 v2 ) {
	float x = dot( v1, v2 );
	float y = abs( x );
	float a = 0.8543985 + ( 0.4965155 + 0.0145206 * y ) * y;
	float b = 3.4175940 + ( 4.1616724 + y ) * y;
	float v = a / b;
	float theta_sintheta = ( x > 0.0 ) ? v : 0.5 * inversesqrt( max( 1.0 - x * x, 1e-7 ) ) - v;
	return cross( v1, v2 ) * theta_sintheta;
}
vec3 LTC_Evaluate( const in vec3 N, const in vec3 V, const in vec3 P, const in mat3 mInv, const in vec3 rectCoords[ 4 ] ) {
	vec3 v1 = rectCoords[ 1 ] - rectCoords[ 0 ];
	vec3 v2 = rectCoords[ 3 ] - rectCoords[ 0 ];
	vec3 lightNormal = cross( v1, v2 );
	if( dot( lightNormal, P - rectCoords[ 0 ] ) < 0.0 ) return vec3( 0.0 );
	vec3 T1, T2;
	T1 = normalize( V - N * dot( V, N ) );
	T2 = - cross( N, T1 );
	mat3 mat = mInv * transposeMat3( mat3( T1, T2, N ) );
	vec3 coords[ 4 ];
	coords[ 0 ] = mat * ( rectCoords[ 0 ] - P );
	coords[ 1 ] = mat * ( rectCoords[ 1 ] - P );
	coords[ 2 ] = mat * ( rectCoords[ 2 ] - P );
	coords[ 3 ] = mat * ( rectCoords[ 3 ] - P );
	coords[ 0 ] = normalize( coords[ 0 ] );
	coords[ 1 ] = normalize( coords[ 1 ] );
	coords[ 2 ] = normalize( coords[ 2 ] );
	coords[ 3 ] = normalize( coords[ 3 ] );
	vec3 vectorFormFactor = vec3( 0.0 );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 0 ], coords[ 1 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 1 ], coords[ 2 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 2 ], coords[ 3 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 3 ], coords[ 0 ] );
	float result = LTC_ClippedSphereFormFactor( vectorFormFactor );
	return vec3( result );
}
#if defined( USE_SHEEN )
float D_Charlie( float roughness, float dotNH ) {
	float alpha = pow2( roughness );
	float invAlpha = 1.0 / alpha;
	float cos2h = dotNH * dotNH;
	float sin2h = max( 1.0 - cos2h, 0.0078125 );
	return ( 2.0 + invAlpha ) * pow( sin2h, invAlpha * 0.5 ) / ( 2.0 * PI );
}
float V_Neubelt( float dotNV, float dotNL ) {
	return saturate( 1.0 / ( 4.0 * ( dotNL + dotNV - dotNL * dotNV ) ) );
}
vec3 BRDF_Sheen( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, vec3 sheenColor, const in float sheenRoughness ) {
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	float dotNH = saturate( dot( normal, halfDir ) );
	float D = D_Charlie( sheenRoughness, dotNH );
	float V = V_Neubelt( dotNV, dotNL );
	return sheenColor * ( D * V );
}
#endif
float IBLSheenBRDF( const in vec3 normal, const in vec3 viewDir, const in float roughness ) {
	float dotNV = saturate( dot( normal, viewDir ) );
	float r2 = roughness * roughness;
	float a = roughness < 0.25 ? -339.2 * r2 + 161.4 * roughness - 25.9 : -8.48 * r2 + 14.3 * roughness - 9.95;
	float b = roughness < 0.25 ? 44.0 * r2 - 23.7 * roughness + 3.26 : 1.97 * r2 - 3.27 * roughness + 0.72;
	float DG = exp( a * dotNV + b ) + ( roughness < 0.25 ? 0.0 : 0.1 * ( roughness - 0.25 ) );
	return saturate( DG * RECIPROCAL_PI );
}
vec2 DFGApprox( const in vec3 normal, const in vec3 viewDir, const in float roughness ) {
	float dotNV = saturate( dot( normal, viewDir ) );
	const vec4 c0 = vec4( - 1, - 0.0275, - 0.572, 0.022 );
	const vec4 c1 = vec4( 1, 0.0425, 1.04, - 0.04 );
	vec4 r = roughness * c0 + c1;
	float a004 = min( r.x * r.x, exp2( - 9.28 * dotNV ) ) * r.x + r.y;
	vec2 fab = vec2( - 1.04, 1.04 ) * a004 + r.zw;
	return fab;
}
vec3 EnvironmentBRDF( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float roughness ) {
	vec2 fab = DFGApprox( normal, viewDir, roughness );
	return specularColor * fab.x + specularF90 * fab.y;
}
#ifdef USE_IRIDESCENCE
void computeMultiscatteringIridescence( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float iridescence, const in vec3 iridescenceF0, const in float roughness, inout vec3 singleScatter, inout vec3 multiScatter ) {
#else
void computeMultiscattering( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float roughness, inout vec3 singleScatter, inout vec3 multiScatter ) {
#endif
	vec2 fab = DFGApprox( normal, viewDir, roughness );
	#ifdef USE_IRIDESCENCE
		vec3 Fr = mix( specularColor, iridescenceF0, iridescence );
	#else
		vec3 Fr = specularColor;
	#endif
	vec3 FssEss = Fr * fab.x + specularF90 * fab.y;
	float Ess = fab.x + fab.y;
	float Ems = 1.0 - Ess;
	vec3 Favg = Fr + ( 1.0 - Fr ) * 0.047619;	vec3 Fms = FssEss * Favg / ( 1.0 - Ems * Favg );
	singleScatter += FssEss;
	multiScatter += Fms * Ems;
}
#if NUM_RECT_AREA_LIGHTS > 0
	void RE_Direct_RectArea_Physical( const in RectAreaLight rectAreaLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
		vec3 normal = geometryNormal;
		vec3 viewDir = geometryViewDir;
		vec3 position = geometryPosition;
		vec3 lightPos = rectAreaLight.position;
		vec3 halfWidth = rectAreaLight.halfWidth;
		vec3 halfHeight = rectAreaLight.halfHeight;
		vec3 lightColor = rectAreaLight.color;
		float roughness = material.roughness;
		vec3 rectCoords[ 4 ];
		rectCoords[ 0 ] = lightPos + halfWidth - halfHeight;		rectCoords[ 1 ] = lightPos - halfWidth - halfHeight;
		rectCoords[ 2 ] = lightPos - halfWidth + halfHeight;
		rectCoords[ 3 ] = lightPos + halfWidth + halfHeight;
		vec2 uv = LTC_Uv( normal, viewDir, roughness );
		vec4 t1 = texture2D( ltc_1, uv );
		vec4 t2 = texture2D( ltc_2, uv );
		mat3 mInv = mat3(
			vec3( t1.x, 0, t1.y ),
			vec3(    0, 1,    0 ),
			vec3( t1.z, 0, t1.w )
		);
		vec3 fresnel = ( material.specularColor * t2.x + ( vec3( 1.0 ) - material.specularColor ) * t2.y );
		reflectedLight.directSpecular += lightColor * fresnel * LTC_Evaluate( normal, viewDir, position, mInv, rectCoords );
		reflectedLight.directDiffuse += lightColor * material.diffuseColor * LTC_Evaluate( normal, viewDir, position, mat3( 1.0 ), rectCoords );
	}
#endif
void RE_Direct_Physical( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	#ifdef USE_CLEARCOAT
		float dotNLcc = saturate( dot( geometryClearcoatNormal, directLight.direction ) );
		vec3 ccIrradiance = dotNLcc * directLight.color;
		clearcoatSpecularDirect += ccIrradiance * BRDF_GGX_Clearcoat( directLight.direction, geometryViewDir, geometryClearcoatNormal, material );
	#endif
	#ifdef USE_SHEEN
		sheenSpecularDirect += irradiance * BRDF_Sheen( directLight.direction, geometryViewDir, geometryNormal, material.sheenColor, material.sheenRoughness );
	#endif
	reflectedLight.directSpecular += irradiance * BRDF_GGX( directLight.direction, geometryViewDir, geometryNormal, material );
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Physical( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectSpecular_Physical( const in vec3 radiance, const in vec3 irradiance, const in vec3 clearcoatRadiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
	#ifdef USE_CLEARCOAT
		clearcoatSpecularIndirect += clearcoatRadiance * EnvironmentBRDF( geometryClearcoatNormal, geometryViewDir, material.clearcoatF0, material.clearcoatF90, material.clearcoatRoughness );
	#endif
	#ifdef USE_SHEEN
		sheenSpecularIndirect += irradiance * material.sheenColor * IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
	#endif
	vec3 singleScattering = vec3( 0.0 );
	vec3 multiScattering = vec3( 0.0 );
	vec3 cosineWeightedIrradiance = irradiance * RECIPROCAL_PI;
	#ifdef USE_IRIDESCENCE
		computeMultiscatteringIridescence( geometryNormal, geometryViewDir, material.specularColor, material.specularF90, material.iridescence, material.iridescenceFresnel, material.roughness, singleScattering, multiScattering );
	#else
		computeMultiscattering( geometryNormal, geometryViewDir, material.specularColor, material.specularF90, material.roughness, singleScattering, multiScattering );
	#endif
	vec3 totalScattering = singleScattering + multiScattering;
	vec3 diffuse = material.diffuseColor * ( 1.0 - max( max( totalScattering.r, totalScattering.g ), totalScattering.b ) );
	reflectedLight.indirectSpecular += radiance * singleScattering;
	reflectedLight.indirectSpecular += multiScattering * cosineWeightedIrradiance;
	reflectedLight.indirectDiffuse += diffuse * cosineWeightedIrradiance;
}
#define RE_Direct				RE_Direct_Physical
#define RE_Direct_RectArea		RE_Direct_RectArea_Physical
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Physical
#define RE_IndirectSpecular		RE_IndirectSpecular_Physical
float computeSpecularOcclusion( const in float dotNV, const in float ambientOcclusion, const in float roughness ) {
	return saturate( pow( dotNV + ambientOcclusion, exp2( - 16.0 * roughness - 1.0 ) ) - 1.0 + ambientOcclusion );
}`,k_=`
vec3 geometryPosition = - vViewPosition;
vec3 geometryNormal = normal;
vec3 geometryViewDir = ( isOrthographic ) ? vec3( 0, 0, 1 ) : normalize( vViewPosition );
vec3 geometryClearcoatNormal = vec3( 0.0 );
#ifdef USE_CLEARCOAT
	geometryClearcoatNormal = clearcoatNormal;
#endif
#ifdef USE_IRIDESCENCE
	float dotNVi = saturate( dot( normal, geometryViewDir ) );
	if ( material.iridescenceThickness == 0.0 ) {
		material.iridescence = 0.0;
	} else {
		material.iridescence = saturate( material.iridescence );
	}
	if ( material.iridescence > 0.0 ) {
		material.iridescenceFresnel = evalIridescence( 1.0, material.iridescenceIOR, dotNVi, material.iridescenceThickness, material.specularColor );
		material.iridescenceF0 = Schlick_to_F0( material.iridescenceFresnel, 1.0, dotNVi );
	}
#endif
IncidentLight directLight;
#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )
	PointLight pointLight;
	#if defined( USE_SHADOWMAP ) && NUM_POINT_LIGHT_SHADOWS > 0
	PointLightShadow pointLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHTS; i ++ ) {
		pointLight = pointLights[ i ];
		getPointLightInfo( pointLight, geometryPosition, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_POINT_LIGHT_SHADOWS )
		pointLightShadow = pointLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getPointShadow( pointShadowMap[ i ], pointLightShadow.shadowMapSize, pointLightShadow.shadowIntensity, pointLightShadow.shadowBias, pointLightShadow.shadowRadius, vPointShadowCoord[ i ], pointLightShadow.shadowCameraNear, pointLightShadow.shadowCameraFar ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )
	SpotLight spotLight;
	vec4 spotColor;
	vec3 spotLightCoord;
	bool inSpotLightMap;
	#if defined( USE_SHADOWMAP ) && NUM_SPOT_LIGHT_SHADOWS > 0
	SpotLightShadow spotLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHTS; i ++ ) {
		spotLight = spotLights[ i ];
		getSpotLightInfo( spotLight, geometryPosition, directLight );
		#if ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS )
		#define SPOT_LIGHT_MAP_INDEX UNROLLED_LOOP_INDEX
		#elif ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
		#define SPOT_LIGHT_MAP_INDEX NUM_SPOT_LIGHT_MAPS
		#else
		#define SPOT_LIGHT_MAP_INDEX ( UNROLLED_LOOP_INDEX - NUM_SPOT_LIGHT_SHADOWS + NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS )
		#endif
		#if ( SPOT_LIGHT_MAP_INDEX < NUM_SPOT_LIGHT_MAPS )
			spotLightCoord = vSpotLightCoord[ i ].xyz / vSpotLightCoord[ i ].w;
			inSpotLightMap = all( lessThan( abs( spotLightCoord * 2. - 1. ), vec3( 1.0 ) ) );
			spotColor = texture2D( spotLightMap[ SPOT_LIGHT_MAP_INDEX ], spotLightCoord.xy );
			directLight.color = inSpotLightMap ? directLight.color * spotColor.rgb : directLight.color;
		#endif
		#undef SPOT_LIGHT_MAP_INDEX
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
		spotLightShadow = spotLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( spotShadowMap[ i ], spotLightShadow.shadowMapSize, spotLightShadow.shadowIntensity, spotLightShadow.shadowBias, spotLightShadow.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )
	DirectionalLight directionalLight;
	#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {
		directionalLight = directionalLights[ i ];
		getDirectionalLightInfo( directionalLight, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )
		directionalLightShadow = directionalLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_RECT_AREA_LIGHTS > 0 ) && defined( RE_Direct_RectArea )
	RectAreaLight rectAreaLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_RECT_AREA_LIGHTS; i ++ ) {
		rectAreaLight = rectAreaLights[ i ];
		RE_Direct_RectArea( rectAreaLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if defined( RE_IndirectDiffuse )
	vec3 iblIrradiance = vec3( 0.0 );
	vec3 irradiance = getAmbientLightIrradiance( ambientLightColor );
	#if defined( USE_LIGHT_PROBES )
		irradiance += getLightProbeIrradiance( lightProbe, geometryNormal );
	#endif
	#if ( NUM_HEMI_LIGHTS > 0 )
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_HEMI_LIGHTS; i ++ ) {
			irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );
		}
		#pragma unroll_loop_end
	#endif
#endif
#if defined( RE_IndirectSpecular )
	vec3 radiance = vec3( 0.0 );
	vec3 clearcoatRadiance = vec3( 0.0 );
#endif`,z_=`#if defined( RE_IndirectDiffuse )
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapIntensity;
		irradiance += lightMapIrradiance;
	#endif
	#if defined( USE_ENVMAP ) && defined( STANDARD ) && defined( ENVMAP_TYPE_CUBE_UV )
		iblIrradiance += getIBLIrradiance( geometryNormal );
	#endif
#endif
#if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
	#ifdef USE_ANISOTROPY
		radiance += getIBLAnisotropyRadiance( geometryViewDir, geometryNormal, material.roughness, material.anisotropyB, material.anisotropy );
	#else
		radiance += getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );
	#endif
	#ifdef USE_CLEARCOAT
		clearcoatRadiance += getIBLRadiance( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness );
	#endif
#endif`,H_=`#if defined( RE_IndirectDiffuse )
	RE_IndirectDiffuse( irradiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif
#if defined( RE_IndirectSpecular )
	RE_IndirectSpecular( radiance, iblIrradiance, clearcoatRadiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif`,V_=`#if defined( USE_LOGDEPTHBUF )
	gl_FragDepth = vIsPerspective == 0.0 ? gl_FragCoord.z : log2( vFragDepth ) * logDepthBufFC * 0.5;
#endif`,G_=`#if defined( USE_LOGDEPTHBUF )
	uniform float logDepthBufFC;
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,W_=`#ifdef USE_LOGDEPTHBUF
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,$_=`#ifdef USE_LOGDEPTHBUF
	vFragDepth = 1.0 + gl_Position.w;
	vIsPerspective = float( isPerspectiveMatrix( projectionMatrix ) );
#endif`,X_=`#ifdef USE_MAP
	vec4 sampledDiffuseColor = texture2D( map, vMapUv );
	#ifdef DECODE_VIDEO_TEXTURE
		sampledDiffuseColor = vec4( mix( pow( sampledDiffuseColor.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), sampledDiffuseColor.rgb * 0.0773993808, vec3( lessThanEqual( sampledDiffuseColor.rgb, vec3( 0.04045 ) ) ) ), sampledDiffuseColor.w );
	
	#endif
	diffuseColor *= sampledDiffuseColor;
#endif`,j_=`#ifdef USE_MAP
	uniform sampler2D map;
#endif`,q_=`#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
	#if defined( USE_POINTS_UV )
		vec2 uv = vUv;
	#else
		vec2 uv = ( uvTransform * vec3( gl_PointCoord.x, 1.0 - gl_PointCoord.y, 1 ) ).xy;
	#endif
#endif
#ifdef USE_MAP
	diffuseColor *= texture2D( map, uv );
#endif
#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, uv ).g;
#endif`,Y_=`#if defined( USE_POINTS_UV )
	varying vec2 vUv;
#else
	#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
		uniform mat3 uvTransform;
	#endif
#endif
#ifdef USE_MAP
	uniform sampler2D map;
#endif
#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,Z_=`float metalnessFactor = metalness;
#ifdef USE_METALNESSMAP
	vec4 texelMetalness = texture2D( metalnessMap, vMetalnessMapUv );
	metalnessFactor *= texelMetalness.b;
#endif`,K_=`#ifdef USE_METALNESSMAP
	uniform sampler2D metalnessMap;
#endif`,J_=`#ifdef USE_INSTANCING_MORPH
	float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	float morphTargetBaseInfluence = texelFetch( morphTexture, ivec2( 0, gl_InstanceID ), 0 ).r;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		morphTargetInfluences[i] =  texelFetch( morphTexture, ivec2( i + 1, gl_InstanceID ), 0 ).r;
	}
#endif`,Q_=`#if defined( USE_MORPHCOLORS )
	vColor *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		#if defined( USE_COLOR_ALPHA )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ) * morphTargetInfluences[ i ];
		#elif defined( USE_COLOR )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ).rgb * morphTargetInfluences[ i ];
		#endif
	}
#endif`,ev=`#ifdef USE_MORPHNORMALS
	objectNormal *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) objectNormal += getMorph( gl_VertexID, i, 1 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,tv=`#ifdef USE_MORPHTARGETS
	#ifndef USE_INSTANCING_MORPH
		uniform float morphTargetBaseInfluence;
		uniform float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	#endif
	uniform sampler2DArray morphTargetsTexture;
	uniform ivec2 morphTargetsTextureSize;
	vec4 getMorph( const in int vertexIndex, const in int morphTargetIndex, const in int offset ) {
		int texelIndex = vertexIndex * MORPHTARGETS_TEXTURE_STRIDE + offset;
		int y = texelIndex / morphTargetsTextureSize.x;
		int x = texelIndex - y * morphTargetsTextureSize.x;
		ivec3 morphUV = ivec3( x, y, morphTargetIndex );
		return texelFetch( morphTargetsTexture, morphUV, 0 );
	}
#endif`,nv=`#ifdef USE_MORPHTARGETS
	transformed *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) transformed += getMorph( gl_VertexID, i, 0 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,iv=`float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
#ifdef FLAT_SHADED
	vec3 fdx = dFdx( vViewPosition );
	vec3 fdy = dFdy( vViewPosition );
	vec3 normal = normalize( cross( fdx, fdy ) );
#else
	vec3 normal = normalize( vNormal );
	#ifdef DOUBLE_SIDED
		normal *= faceDirection;
	#endif
#endif
#if defined( USE_NORMALMAP_TANGENTSPACE ) || defined( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY )
	#ifdef USE_TANGENT
		mat3 tbn = mat3( normalize( vTangent ), normalize( vBitangent ), normal );
	#else
		mat3 tbn = getTangentFrame( - vViewPosition, normal,
		#if defined( USE_NORMALMAP )
			vNormalMapUv
		#elif defined( USE_CLEARCOAT_NORMALMAP )
			vClearcoatNormalMapUv
		#else
			vUv
		#endif
		);
	#endif
	#if defined( DOUBLE_SIDED ) && ! defined( FLAT_SHADED )
		tbn[0] *= faceDirection;
		tbn[1] *= faceDirection;
	#endif
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	#ifdef USE_TANGENT
		mat3 tbn2 = mat3( normalize( vTangent ), normalize( vBitangent ), normal );
	#else
		mat3 tbn2 = getTangentFrame( - vViewPosition, normal, vClearcoatNormalMapUv );
	#endif
	#if defined( DOUBLE_SIDED ) && ! defined( FLAT_SHADED )
		tbn2[0] *= faceDirection;
		tbn2[1] *= faceDirection;
	#endif
#endif
vec3 nonPerturbedNormal = normal;`,rv=`#ifdef USE_NORMALMAP_OBJECTSPACE
	normal = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	#ifdef FLIP_SIDED
		normal = - normal;
	#endif
	#ifdef DOUBLE_SIDED
		normal = normal * faceDirection;
	#endif
	normal = normalize( normalMatrix * normal );
#elif defined( USE_NORMALMAP_TANGENTSPACE )
	vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	mapN.xy *= normalScale;
	normal = normalize( tbn * mapN );
#elif defined( USE_BUMPMAP )
	normal = perturbNormalArb( - vViewPosition, normal, dHdxy_fwd(), faceDirection );
#endif`,sv=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,ov=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,av=`#ifndef FLAT_SHADED
	vNormal = normalize( transformedNormal );
	#ifdef USE_TANGENT
		vTangent = normalize( transformedTangent );
		vBitangent = normalize( cross( vNormal, vTangent ) * tangent.w );
	#endif
#endif`,lv=`#ifdef USE_NORMALMAP
	uniform sampler2D normalMap;
	uniform vec2 normalScale;
#endif
#ifdef USE_NORMALMAP_OBJECTSPACE
	uniform mat3 normalMatrix;
#endif
#if ! defined ( USE_TANGENT ) && ( defined ( USE_NORMALMAP_TANGENTSPACE ) || defined ( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY ) )
	mat3 getTangentFrame( vec3 eye_pos, vec3 surf_norm, vec2 uv ) {
		vec3 q0 = dFdx( eye_pos.xyz );
		vec3 q1 = dFdy( eye_pos.xyz );
		vec2 st0 = dFdx( uv.st );
		vec2 st1 = dFdy( uv.st );
		vec3 N = surf_norm;
		vec3 q1perp = cross( q1, N );
		vec3 q0perp = cross( N, q0 );
		vec3 T = q1perp * st0.x + q0perp * st1.x;
		vec3 B = q1perp * st0.y + q0perp * st1.y;
		float det = max( dot( T, T ), dot( B, B ) );
		float scale = ( det == 0.0 ) ? 0.0 : inversesqrt( det );
		return mat3( T * scale, B * scale, N );
	}
#endif`,cv=`#ifdef USE_CLEARCOAT
	vec3 clearcoatNormal = nonPerturbedNormal;
#endif`,uv=`#ifdef USE_CLEARCOAT_NORMALMAP
	vec3 clearcoatMapN = texture2D( clearcoatNormalMap, vClearcoatNormalMapUv ).xyz * 2.0 - 1.0;
	clearcoatMapN.xy *= clearcoatNormalScale;
	clearcoatNormal = normalize( tbn2 * clearcoatMapN );
#endif`,dv=`#ifdef USE_CLEARCOATMAP
	uniform sampler2D clearcoatMap;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform sampler2D clearcoatNormalMap;
	uniform vec2 clearcoatNormalScale;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform sampler2D clearcoatRoughnessMap;
#endif`,hv=`#ifdef USE_IRIDESCENCEMAP
	uniform sampler2D iridescenceMap;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform sampler2D iridescenceThicknessMap;
#endif`,fv=`#ifdef OPAQUE
diffuseColor.a = 1.0;
#endif
#ifdef USE_TRANSMISSION
diffuseColor.a *= material.transmissionAlpha;
#endif
gl_FragColor = vec4( outgoingLight, diffuseColor.a );`,pv=`vec3 packNormalToRGB( const in vec3 normal ) {
	return normalize( normal ) * 0.5 + 0.5;
}
vec3 unpackRGBToNormal( const in vec3 rgb ) {
	return 2.0 * rgb.xyz - 1.0;
}
const float PackUpscale = 256. / 255.;const float UnpackDownscale = 255. / 256.;const float ShiftRight8 = 1. / 256.;
const float Inv255 = 1. / 255.;
const vec4 PackFactors = vec4( 1.0, 256.0, 256.0 * 256.0, 256.0 * 256.0 * 256.0 );
const vec2 UnpackFactors2 = vec2( UnpackDownscale, 1.0 / PackFactors.g );
const vec3 UnpackFactors3 = vec3( UnpackDownscale / PackFactors.rg, 1.0 / PackFactors.b );
const vec4 UnpackFactors4 = vec4( UnpackDownscale / PackFactors.rgb, 1.0 / PackFactors.a );
vec4 packDepthToRGBA( const in float v ) {
	if( v <= 0.0 )
		return vec4( 0., 0., 0., 0. );
	if( v >= 1.0 )
		return vec4( 1., 1., 1., 1. );
	float vuf;
	float af = modf( v * PackFactors.a, vuf );
	float bf = modf( vuf * ShiftRight8, vuf );
	float gf = modf( vuf * ShiftRight8, vuf );
	return vec4( vuf * Inv255, gf * PackUpscale, bf * PackUpscale, af );
}
vec3 packDepthToRGB( const in float v ) {
	if( v <= 0.0 )
		return vec3( 0., 0., 0. );
	if( v >= 1.0 )
		return vec3( 1., 1., 1. );
	float vuf;
	float bf = modf( v * PackFactors.b, vuf );
	float gf = modf( vuf * ShiftRight8, vuf );
	return vec3( vuf * Inv255, gf * PackUpscale, bf );
}
vec2 packDepthToRG( const in float v ) {
	if( v <= 0.0 )
		return vec2( 0., 0. );
	if( v >= 1.0 )
		return vec2( 1., 1. );
	float vuf;
	float gf = modf( v * 256., vuf );
	return vec2( vuf * Inv255, gf );
}
float unpackRGBAToDepth( const in vec4 v ) {
	return dot( v, UnpackFactors4 );
}
float unpackRGBToDepth( const in vec3 v ) {
	return dot( v, UnpackFactors3 );
}
float unpackRGToDepth( const in vec2 v ) {
	return v.r * UnpackFactors2.r + v.g * UnpackFactors2.g;
}
vec4 pack2HalfToRGBA( const in vec2 v ) {
	vec4 r = vec4( v.x, fract( v.x * 255.0 ), v.y, fract( v.y * 255.0 ) );
	return vec4( r.x - r.y / 255.0, r.y, r.z - r.w / 255.0, r.w );
}
vec2 unpackRGBATo2Half( const in vec4 v ) {
	return vec2( v.x + ( v.y / 255.0 ), v.z + ( v.w / 255.0 ) );
}
float viewZToOrthographicDepth( const in float viewZ, const in float near, const in float far ) {
	return ( viewZ + near ) / ( near - far );
}
float orthographicDepthToViewZ( const in float depth, const in float near, const in float far ) {
	return depth * ( near - far ) - near;
}
float viewZToPerspectiveDepth( const in float viewZ, const in float near, const in float far ) {
	return ( ( near + viewZ ) * far ) / ( ( far - near ) * viewZ );
}
float perspectiveDepthToViewZ( const in float depth, const in float near, const in float far ) {
	return ( near * far ) / ( ( far - near ) * depth - far );
}`,mv=`#ifdef PREMULTIPLIED_ALPHA
	gl_FragColor.rgb *= gl_FragColor.a;
#endif`,gv=`vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
	mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`,_v=`#ifdef DITHERING
	gl_FragColor.rgb = dithering( gl_FragColor.rgb );
#endif`,vv=`#ifdef DITHERING
	vec3 dithering( vec3 color ) {
		float grid_position = rand( gl_FragCoord.xy );
		vec3 dither_shift_RGB = vec3( 0.25 / 255.0, -0.25 / 255.0, 0.25 / 255.0 );
		dither_shift_RGB = mix( 2.0 * dither_shift_RGB, -2.0 * dither_shift_RGB, grid_position );
		return color + dither_shift_RGB;
	}
#endif`,yv=`float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
	vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
	roughnessFactor *= texelRoughness.g;
#endif`,xv=`#ifdef USE_ROUGHNESSMAP
	uniform sampler2D roughnessMap;
#endif`,bv=`#if NUM_SPOT_LIGHT_COORDS > 0
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#if NUM_SPOT_LIGHT_MAPS > 0
	uniform sampler2D spotLightMap[ NUM_SPOT_LIGHT_MAPS ];
#endif
#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
		uniform sampler2D directionalShadowMap[ NUM_DIR_LIGHT_SHADOWS ];
		varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
		struct DirectionalLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
		uniform sampler2D spotShadowMap[ NUM_SPOT_LIGHT_SHADOWS ];
		struct SpotLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		uniform sampler2D pointShadowMap[ NUM_POINT_LIGHT_SHADOWS ];
		varying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];
		struct PointLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
			float shadowCameraNear;
			float shadowCameraFar;
		};
		uniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];
	#endif
	float texture2DCompare( sampler2D depths, vec2 uv, float compare ) {
		return step( compare, unpackRGBAToDepth( texture2D( depths, uv ) ) );
	}
	vec2 texture2DDistribution( sampler2D shadow, vec2 uv ) {
		return unpackRGBATo2Half( texture2D( shadow, uv ) );
	}
	float VSMShadow (sampler2D shadow, vec2 uv, float compare ){
		float occlusion = 1.0;
		vec2 distribution = texture2DDistribution( shadow, uv );
		float hard_shadow = step( compare , distribution.x );
		if (hard_shadow != 1.0 ) {
			float distance = compare - distribution.x ;
			float variance = max( 0.00000, distribution.y * distribution.y );
			float softness_probability = variance / (variance + distance * distance );			softness_probability = clamp( ( softness_probability - 0.3 ) / ( 0.95 - 0.3 ), 0.0, 1.0 );			occlusion = clamp( max( hard_shadow, softness_probability ), 0.0, 1.0 );
		}
		return occlusion;
	}
	float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
		float shadow = 1.0;
		shadowCoord.xyz /= shadowCoord.w;
		shadowCoord.z += shadowBias;
		bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
		bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
		if ( frustumTest ) {
		#if defined( SHADOWMAP_TYPE_PCF )
			vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
			float dx0 = - texelSize.x * shadowRadius;
			float dy0 = - texelSize.y * shadowRadius;
			float dx1 = + texelSize.x * shadowRadius;
			float dy1 = + texelSize.y * shadowRadius;
			float dx2 = dx0 / 2.0;
			float dy2 = dy0 / 2.0;
			float dx3 = dx1 / 2.0;
			float dy3 = dy1 / 2.0;
			shadow = (
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx0, dy0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx1, dy0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx2, dy2 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy2 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx3, dy2 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx0, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx2, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy, shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx3, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx1, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx2, dy3 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy3 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx3, dy3 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx0, dy1 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy1 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx1, dy1 ), shadowCoord.z )
			) * ( 1.0 / 17.0 );
		#elif defined( SHADOWMAP_TYPE_PCF_SOFT )
			vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
			float dx = texelSize.x;
			float dy = texelSize.y;
			vec2 uv = shadowCoord.xy;
			vec2 f = fract( uv * shadowMapSize + 0.5 );
			uv -= f * texelSize;
			shadow = (
				texture2DCompare( shadowMap, uv, shadowCoord.z ) +
				texture2DCompare( shadowMap, uv + vec2( dx, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, uv + vec2( 0.0, dy ), shadowCoord.z ) +
				texture2DCompare( shadowMap, uv + texelSize, shadowCoord.z ) +
				mix( texture2DCompare( shadowMap, uv + vec2( -dx, 0.0 ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, 0.0 ), shadowCoord.z ),
					 f.x ) +
				mix( texture2DCompare( shadowMap, uv + vec2( -dx, dy ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, dy ), shadowCoord.z ),
					 f.x ) +
				mix( texture2DCompare( shadowMap, uv + vec2( 0.0, -dy ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( 0.0, 2.0 * dy ), shadowCoord.z ),
					 f.y ) +
				mix( texture2DCompare( shadowMap, uv + vec2( dx, -dy ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( dx, 2.0 * dy ), shadowCoord.z ),
					 f.y ) +
				mix( mix( texture2DCompare( shadowMap, uv + vec2( -dx, -dy ), shadowCoord.z ),
						  texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, -dy ), shadowCoord.z ),
						  f.x ),
					 mix( texture2DCompare( shadowMap, uv + vec2( -dx, 2.0 * dy ), shadowCoord.z ),
						  texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, 2.0 * dy ), shadowCoord.z ),
						  f.x ),
					 f.y )
			) * ( 1.0 / 9.0 );
		#elif defined( SHADOWMAP_TYPE_VSM )
			shadow = VSMShadow( shadowMap, shadowCoord.xy, shadowCoord.z );
		#else
			shadow = texture2DCompare( shadowMap, shadowCoord.xy, shadowCoord.z );
		#endif
		}
		return mix( 1.0, shadow, shadowIntensity );
	}
	vec2 cubeToUV( vec3 v, float texelSizeY ) {
		vec3 absV = abs( v );
		float scaleToCube = 1.0 / max( absV.x, max( absV.y, absV.z ) );
		absV *= scaleToCube;
		v *= scaleToCube * ( 1.0 - 2.0 * texelSizeY );
		vec2 planar = v.xy;
		float almostATexel = 1.5 * texelSizeY;
		float almostOne = 1.0 - almostATexel;
		if ( absV.z >= almostOne ) {
			if ( v.z > 0.0 )
				planar.x = 4.0 - v.x;
		} else if ( absV.x >= almostOne ) {
			float signX = sign( v.x );
			planar.x = v.z * signX + 2.0 * signX;
		} else if ( absV.y >= almostOne ) {
			float signY = sign( v.y );
			planar.x = v.x + 2.0 * signY + 2.0;
			planar.y = v.z * signY - 2.0;
		}
		return vec2( 0.125, 0.25 ) * planar + vec2( 0.375, 0.75 );
	}
	float getPointShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord, float shadowCameraNear, float shadowCameraFar ) {
		float shadow = 1.0;
		vec3 lightToPosition = shadowCoord.xyz;
		
		float lightToPositionLength = length( lightToPosition );
		if ( lightToPositionLength - shadowCameraFar <= 0.0 && lightToPositionLength - shadowCameraNear >= 0.0 ) {
			float dp = ( lightToPositionLength - shadowCameraNear ) / ( shadowCameraFar - shadowCameraNear );			dp += shadowBias;
			vec3 bd3D = normalize( lightToPosition );
			vec2 texelSize = vec2( 1.0 ) / ( shadowMapSize * vec2( 4.0, 2.0 ) );
			#if defined( SHADOWMAP_TYPE_PCF ) || defined( SHADOWMAP_TYPE_PCF_SOFT ) || defined( SHADOWMAP_TYPE_VSM )
				vec2 offset = vec2( - 1, 1 ) * shadowRadius * texelSize.y;
				shadow = (
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xyy, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yyy, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xyx, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yyx, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xxy, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yxy, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xxx, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yxx, texelSize.y ), dp )
				) * ( 1.0 / 9.0 );
			#else
				shadow = texture2DCompare( shadowMap, cubeToUV( bd3D, texelSize.y ), dp );
			#endif
		}
		return mix( 1.0, shadow, shadowIntensity );
	}
#endif`,Sv=`#if NUM_SPOT_LIGHT_COORDS > 0
	uniform mat4 spotLightMatrix[ NUM_SPOT_LIGHT_COORDS ];
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
		uniform mat4 directionalShadowMatrix[ NUM_DIR_LIGHT_SHADOWS ];
		varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
		struct DirectionalLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
		struct SpotLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		uniform mat4 pointShadowMatrix[ NUM_POINT_LIGHT_SHADOWS ];
		varying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];
		struct PointLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
			float shadowCameraNear;
			float shadowCameraFar;
		};
		uniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];
	#endif
#endif`,Mv=`#if ( defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 0 || NUM_POINT_LIGHT_SHADOWS > 0 ) ) || ( NUM_SPOT_LIGHT_COORDS > 0 )
	vec3 shadowWorldNormal = inverseTransformDirection( transformedNormal, viewMatrix );
	vec4 shadowWorldPosition;
#endif
#if defined( USE_SHADOWMAP )
	#if NUM_DIR_LIGHT_SHADOWS > 0
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
			shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * directionalLightShadows[ i ].shadowNormalBias, 0 );
			vDirectionalShadowCoord[ i ] = directionalShadowMatrix[ i ] * shadowWorldPosition;
		}
		#pragma unroll_loop_end
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
			shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * pointLightShadows[ i ].shadowNormalBias, 0 );
			vPointShadowCoord[ i ] = pointShadowMatrix[ i ] * shadowWorldPosition;
		}
		#pragma unroll_loop_end
	#endif
#endif
#if NUM_SPOT_LIGHT_COORDS > 0
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_COORDS; i ++ ) {
		shadowWorldPosition = worldPosition;
		#if ( defined( USE_SHADOWMAP ) && UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
			shadowWorldPosition.xyz += shadowWorldNormal * spotLightShadows[ i ].shadowNormalBias;
		#endif
		vSpotLightCoord[ i ] = spotLightMatrix[ i ] * shadowWorldPosition;
	}
	#pragma unroll_loop_end
#endif`,wv=`float getShadowMask() {
	float shadow = 1.0;
	#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
		directionalLight = directionalLightShadows[ i ];
		shadow *= receiveShadow ? getShadow( directionalShadowMap[ i ], directionalLight.shadowMapSize, directionalLight.shadowIntensity, directionalLight.shadowBias, directionalLight.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
	SpotLightShadow spotLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_SHADOWS; i ++ ) {
		spotLight = spotLightShadows[ i ];
		shadow *= receiveShadow ? getShadow( spotShadowMap[ i ], spotLight.shadowMapSize, spotLight.shadowIntensity, spotLight.shadowBias, spotLight.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
	PointLightShadow pointLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
		pointLight = pointLightShadows[ i ];
		shadow *= receiveShadow ? getPointShadow( pointShadowMap[ i ], pointLight.shadowMapSize, pointLight.shadowIntensity, pointLight.shadowBias, pointLight.shadowRadius, vPointShadowCoord[ i ], pointLight.shadowCameraNear, pointLight.shadowCameraFar ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#endif
	return shadow;
}`,Ev=`#ifdef USE_SKINNING
	mat4 boneMatX = getBoneMatrix( skinIndex.x );
	mat4 boneMatY = getBoneMatrix( skinIndex.y );
	mat4 boneMatZ = getBoneMatrix( skinIndex.z );
	mat4 boneMatW = getBoneMatrix( skinIndex.w );
#endif`,Tv=`#ifdef USE_SKINNING
	uniform mat4 bindMatrix;
	uniform mat4 bindMatrixInverse;
	uniform highp sampler2D boneTexture;
	mat4 getBoneMatrix( const in float i ) {
		int size = textureSize( boneTexture, 0 ).x;
		int j = int( i ) * 4;
		int x = j % size;
		int y = j / size;
		vec4 v1 = texelFetch( boneTexture, ivec2( x, y ), 0 );
		vec4 v2 = texelFetch( boneTexture, ivec2( x + 1, y ), 0 );
		vec4 v3 = texelFetch( boneTexture, ivec2( x + 2, y ), 0 );
		vec4 v4 = texelFetch( boneTexture, ivec2( x + 3, y ), 0 );
		return mat4( v1, v2, v3, v4 );
	}
#endif`,Av=`#ifdef USE_SKINNING
	vec4 skinVertex = bindMatrix * vec4( transformed, 1.0 );
	vec4 skinned = vec4( 0.0 );
	skinned += boneMatX * skinVertex * skinWeight.x;
	skinned += boneMatY * skinVertex * skinWeight.y;
	skinned += boneMatZ * skinVertex * skinWeight.z;
	skinned += boneMatW * skinVertex * skinWeight.w;
	transformed = ( bindMatrixInverse * skinned ).xyz;
#endif`,Cv=`#ifdef USE_SKINNING
	mat4 skinMatrix = mat4( 0.0 );
	skinMatrix += skinWeight.x * boneMatX;
	skinMatrix += skinWeight.y * boneMatY;
	skinMatrix += skinWeight.z * boneMatZ;
	skinMatrix += skinWeight.w * boneMatW;
	skinMatrix = bindMatrixInverse * skinMatrix * bindMatrix;
	objectNormal = vec4( skinMatrix * vec4( objectNormal, 0.0 ) ).xyz;
	#ifdef USE_TANGENT
		objectTangent = vec4( skinMatrix * vec4( objectTangent, 0.0 ) ).xyz;
	#endif
#endif`,Pv=`float specularStrength;
#ifdef USE_SPECULARMAP
	vec4 texelSpecular = texture2D( specularMap, vSpecularMapUv );
	specularStrength = texelSpecular.r;
#else
	specularStrength = 1.0;
#endif`,Rv=`#ifdef USE_SPECULARMAP
	uniform sampler2D specularMap;
#endif`,Lv=`#if defined( TONE_MAPPING )
	gl_FragColor.rgb = toneMapping( gl_FragColor.rgb );
#endif`,Iv=`#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
uniform float toneMappingExposure;
vec3 LinearToneMapping( vec3 color ) {
	return saturate( toneMappingExposure * color );
}
vec3 ReinhardToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	return saturate( color / ( vec3( 1.0 ) + color ) );
}
vec3 CineonToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	color = max( vec3( 0.0 ), color - 0.004 );
	return pow( ( color * ( 6.2 * color + 0.5 ) ) / ( color * ( 6.2 * color + 1.7 ) + 0.06 ), vec3( 2.2 ) );
}
vec3 RRTAndODTFit( vec3 v ) {
	vec3 a = v * ( v + 0.0245786 ) - 0.000090537;
	vec3 b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081;
	return a / b;
}
vec3 ACESFilmicToneMapping( vec3 color ) {
	const mat3 ACESInputMat = mat3(
		vec3( 0.59719, 0.07600, 0.02840 ),		vec3( 0.35458, 0.90834, 0.13383 ),
		vec3( 0.04823, 0.01566, 0.83777 )
	);
	const mat3 ACESOutputMat = mat3(
		vec3(  1.60475, -0.10208, -0.00327 ),		vec3( -0.53108,  1.10813, -0.07276 ),
		vec3( -0.07367, -0.00605,  1.07602 )
	);
	color *= toneMappingExposure / 0.6;
	color = ACESInputMat * color;
	color = RRTAndODTFit( color );
	color = ACESOutputMat * color;
	return saturate( color );
}
const mat3 LINEAR_REC2020_TO_LINEAR_SRGB = mat3(
	vec3( 1.6605, - 0.1246, - 0.0182 ),
	vec3( - 0.5876, 1.1329, - 0.1006 ),
	vec3( - 0.0728, - 0.0083, 1.1187 )
);
const mat3 LINEAR_SRGB_TO_LINEAR_REC2020 = mat3(
	vec3( 0.6274, 0.0691, 0.0164 ),
	vec3( 0.3293, 0.9195, 0.0880 ),
	vec3( 0.0433, 0.0113, 0.8956 )
);
vec3 agxDefaultContrastApprox( vec3 x ) {
	vec3 x2 = x * x;
	vec3 x4 = x2 * x2;
	return + 15.5 * x4 * x2
		- 40.14 * x4 * x
		+ 31.96 * x4
		- 6.868 * x2 * x
		+ 0.4298 * x2
		+ 0.1191 * x
		- 0.00232;
}
vec3 AgXToneMapping( vec3 color ) {
	const mat3 AgXInsetMatrix = mat3(
		vec3( 0.856627153315983, 0.137318972929847, 0.11189821299995 ),
		vec3( 0.0951212405381588, 0.761241990602591, 0.0767994186031903 ),
		vec3( 0.0482516061458583, 0.101439036467562, 0.811302368396859 )
	);
	const mat3 AgXOutsetMatrix = mat3(
		vec3( 1.1271005818144368, - 0.1413297634984383, - 0.14132976349843826 ),
		vec3( - 0.11060664309660323, 1.157823702216272, - 0.11060664309660294 ),
		vec3( - 0.016493938717834573, - 0.016493938717834257, 1.2519364065950405 )
	);
	const float AgxMinEv = - 12.47393;	const float AgxMaxEv = 4.026069;
	color *= toneMappingExposure;
	color = LINEAR_SRGB_TO_LINEAR_REC2020 * color;
	color = AgXInsetMatrix * color;
	color = max( color, 1e-10 );	color = log2( color );
	color = ( color - AgxMinEv ) / ( AgxMaxEv - AgxMinEv );
	color = clamp( color, 0.0, 1.0 );
	color = agxDefaultContrastApprox( color );
	color = AgXOutsetMatrix * color;
	color = pow( max( vec3( 0.0 ), color ), vec3( 2.2 ) );
	color = LINEAR_REC2020_TO_LINEAR_SRGB * color;
	color = clamp( color, 0.0, 1.0 );
	return color;
}
vec3 NeutralToneMapping( vec3 color ) {
	const float StartCompression = 0.8 - 0.04;
	const float Desaturation = 0.15;
	color *= toneMappingExposure;
	float x = min( color.r, min( color.g, color.b ) );
	float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
	color -= offset;
	float peak = max( color.r, max( color.g, color.b ) );
	if ( peak < StartCompression ) return color;
	float d = 1. - StartCompression;
	float newPeak = 1. - d * d / ( peak + d - StartCompression );
	color *= newPeak / peak;
	float g = 1. - 1. / ( Desaturation * ( peak - newPeak ) + 1. );
	return mix( color, vec3( newPeak ), g );
}
vec3 CustomToneMapping( vec3 color ) { return color; }`,Dv=`#ifdef USE_TRANSMISSION
	material.transmission = transmission;
	material.transmissionAlpha = 1.0;
	material.thickness = thickness;
	material.attenuationDistance = attenuationDistance;
	material.attenuationColor = attenuationColor;
	#ifdef USE_TRANSMISSIONMAP
		material.transmission *= texture2D( transmissionMap, vTransmissionMapUv ).r;
	#endif
	#ifdef USE_THICKNESSMAP
		material.thickness *= texture2D( thicknessMap, vThicknessMapUv ).g;
	#endif
	vec3 pos = vWorldPosition;
	vec3 v = normalize( cameraPosition - pos );
	vec3 n = inverseTransformDirection( normal, viewMatrix );
	vec4 transmitted = getIBLVolumeRefraction(
		n, v, material.roughness, material.diffuseColor, material.specularColor, material.specularF90,
		pos, modelMatrix, viewMatrix, projectionMatrix, material.dispersion, material.ior, material.thickness,
		material.attenuationColor, material.attenuationDistance );
	material.transmissionAlpha = mix( material.transmissionAlpha, transmitted.a, material.transmission );
	totalDiffuse = mix( totalDiffuse, transmitted.rgb, material.transmission );
#endif`,Nv=`#ifdef USE_TRANSMISSION
	uniform float transmission;
	uniform float thickness;
	uniform float attenuationDistance;
	uniform vec3 attenuationColor;
	#ifdef USE_TRANSMISSIONMAP
		uniform sampler2D transmissionMap;
	#endif
	#ifdef USE_THICKNESSMAP
		uniform sampler2D thicknessMap;
	#endif
	uniform vec2 transmissionSamplerSize;
	uniform sampler2D transmissionSamplerMap;
	uniform mat4 modelMatrix;
	uniform mat4 projectionMatrix;
	varying vec3 vWorldPosition;
	float w0( float a ) {
		return ( 1.0 / 6.0 ) * ( a * ( a * ( - a + 3.0 ) - 3.0 ) + 1.0 );
	}
	float w1( float a ) {
		return ( 1.0 / 6.0 ) * ( a *  a * ( 3.0 * a - 6.0 ) + 4.0 );
	}
	float w2( float a ){
		return ( 1.0 / 6.0 ) * ( a * ( a * ( - 3.0 * a + 3.0 ) + 3.0 ) + 1.0 );
	}
	float w3( float a ) {
		return ( 1.0 / 6.0 ) * ( a * a * a );
	}
	float g0( float a ) {
		return w0( a ) + w1( a );
	}
	float g1( float a ) {
		return w2( a ) + w3( a );
	}
	float h0( float a ) {
		return - 1.0 + w1( a ) / ( w0( a ) + w1( a ) );
	}
	float h1( float a ) {
		return 1.0 + w3( a ) / ( w2( a ) + w3( a ) );
	}
	vec4 bicubic( sampler2D tex, vec2 uv, vec4 texelSize, float lod ) {
		uv = uv * texelSize.zw + 0.5;
		vec2 iuv = floor( uv );
		vec2 fuv = fract( uv );
		float g0x = g0( fuv.x );
		float g1x = g1( fuv.x );
		float h0x = h0( fuv.x );
		float h1x = h1( fuv.x );
		float h0y = h0( fuv.y );
		float h1y = h1( fuv.y );
		vec2 p0 = ( vec2( iuv.x + h0x, iuv.y + h0y ) - 0.5 ) * texelSize.xy;
		vec2 p1 = ( vec2( iuv.x + h1x, iuv.y + h0y ) - 0.5 ) * texelSize.xy;
		vec2 p2 = ( vec2( iuv.x + h0x, iuv.y + h1y ) - 0.5 ) * texelSize.xy;
		vec2 p3 = ( vec2( iuv.x + h1x, iuv.y + h1y ) - 0.5 ) * texelSize.xy;
		return g0( fuv.y ) * ( g0x * textureLod( tex, p0, lod ) + g1x * textureLod( tex, p1, lod ) ) +
			g1( fuv.y ) * ( g0x * textureLod( tex, p2, lod ) + g1x * textureLod( tex, p3, lod ) );
	}
	vec4 textureBicubic( sampler2D sampler, vec2 uv, float lod ) {
		vec2 fLodSize = vec2( textureSize( sampler, int( lod ) ) );
		vec2 cLodSize = vec2( textureSize( sampler, int( lod + 1.0 ) ) );
		vec2 fLodSizeInv = 1.0 / fLodSize;
		vec2 cLodSizeInv = 1.0 / cLodSize;
		vec4 fSample = bicubic( sampler, uv, vec4( fLodSizeInv, fLodSize ), floor( lod ) );
		vec4 cSample = bicubic( sampler, uv, vec4( cLodSizeInv, cLodSize ), ceil( lod ) );
		return mix( fSample, cSample, fract( lod ) );
	}
	vec3 getVolumeTransmissionRay( const in vec3 n, const in vec3 v, const in float thickness, const in float ior, const in mat4 modelMatrix ) {
		vec3 refractionVector = refract( - v, normalize( n ), 1.0 / ior );
		vec3 modelScale;
		modelScale.x = length( vec3( modelMatrix[ 0 ].xyz ) );
		modelScale.y = length( vec3( modelMatrix[ 1 ].xyz ) );
		modelScale.z = length( vec3( modelMatrix[ 2 ].xyz ) );
		return normalize( refractionVector ) * thickness * modelScale;
	}
	float applyIorToRoughness( const in float roughness, const in float ior ) {
		return roughness * clamp( ior * 2.0 - 2.0, 0.0, 1.0 );
	}
	vec4 getTransmissionSample( const in vec2 fragCoord, const in float roughness, const in float ior ) {
		float lod = log2( transmissionSamplerSize.x ) * applyIorToRoughness( roughness, ior );
		return textureBicubic( transmissionSamplerMap, fragCoord.xy, lod );
	}
	vec3 volumeAttenuation( const in float transmissionDistance, const in vec3 attenuationColor, const in float attenuationDistance ) {
		if ( isinf( attenuationDistance ) ) {
			return vec3( 1.0 );
		} else {
			vec3 attenuationCoefficient = -log( attenuationColor ) / attenuationDistance;
			vec3 transmittance = exp( - attenuationCoefficient * transmissionDistance );			return transmittance;
		}
	}
	vec4 getIBLVolumeRefraction( const in vec3 n, const in vec3 v, const in float roughness, const in vec3 diffuseColor,
		const in vec3 specularColor, const in float specularF90, const in vec3 position, const in mat4 modelMatrix,
		const in mat4 viewMatrix, const in mat4 projMatrix, const in float dispersion, const in float ior, const in float thickness,
		const in vec3 attenuationColor, const in float attenuationDistance ) {
		vec4 transmittedLight;
		vec3 transmittance;
		#ifdef USE_DISPERSION
			float halfSpread = ( ior - 1.0 ) * 0.025 * dispersion;
			vec3 iors = vec3( ior - halfSpread, ior, ior + halfSpread );
			for ( int i = 0; i < 3; i ++ ) {
				vec3 transmissionRay = getVolumeTransmissionRay( n, v, thickness, iors[ i ], modelMatrix );
				vec3 refractedRayExit = position + transmissionRay;
		
				vec4 ndcPos = projMatrix * viewMatrix * vec4( refractedRayExit, 1.0 );
				vec2 refractionCoords = ndcPos.xy / ndcPos.w;
				refractionCoords += 1.0;
				refractionCoords /= 2.0;
		
				vec4 transmissionSample = getTransmissionSample( refractionCoords, roughness, iors[ i ] );
				transmittedLight[ i ] = transmissionSample[ i ];
				transmittedLight.a += transmissionSample.a;
				transmittance[ i ] = diffuseColor[ i ] * volumeAttenuation( length( transmissionRay ), attenuationColor, attenuationDistance )[ i ];
			}
			transmittedLight.a /= 3.0;
		
		#else
		
			vec3 transmissionRay = getVolumeTransmissionRay( n, v, thickness, ior, modelMatrix );
			vec3 refractedRayExit = position + transmissionRay;
			vec4 ndcPos = projMatrix * viewMatrix * vec4( refractedRayExit, 1.0 );
			vec2 refractionCoords = ndcPos.xy / ndcPos.w;
			refractionCoords += 1.0;
			refractionCoords /= 2.0;
			transmittedLight = getTransmissionSample( refractionCoords, roughness, ior );
			transmittance = diffuseColor * volumeAttenuation( length( transmissionRay ), attenuationColor, attenuationDistance );
		
		#endif
		vec3 attenuatedColor = transmittance * transmittedLight.rgb;
		vec3 F = EnvironmentBRDF( n, v, specularColor, specularF90, roughness );
		float transmittanceFactor = ( transmittance.r + transmittance.g + transmittance.b ) / 3.0;
		return vec4( ( 1.0 - F ) * attenuatedColor, 1.0 - ( 1.0 - transmittedLight.a ) * transmittanceFactor );
	}
#endif`,Uv=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	varying vec2 vUv;
#endif
#ifdef USE_MAP
	varying vec2 vMapUv;
#endif
#ifdef USE_ALPHAMAP
	varying vec2 vAlphaMapUv;
#endif
#ifdef USE_LIGHTMAP
	varying vec2 vLightMapUv;
#endif
#ifdef USE_AOMAP
	varying vec2 vAoMapUv;
#endif
#ifdef USE_BUMPMAP
	varying vec2 vBumpMapUv;
#endif
#ifdef USE_NORMALMAP
	varying vec2 vNormalMapUv;
#endif
#ifdef USE_EMISSIVEMAP
	varying vec2 vEmissiveMapUv;
#endif
#ifdef USE_METALNESSMAP
	varying vec2 vMetalnessMapUv;
#endif
#ifdef USE_ROUGHNESSMAP
	varying vec2 vRoughnessMapUv;
#endif
#ifdef USE_ANISOTROPYMAP
	varying vec2 vAnisotropyMapUv;
#endif
#ifdef USE_CLEARCOATMAP
	varying vec2 vClearcoatMapUv;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	varying vec2 vClearcoatNormalMapUv;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	varying vec2 vClearcoatRoughnessMapUv;
#endif
#ifdef USE_IRIDESCENCEMAP
	varying vec2 vIridescenceMapUv;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	varying vec2 vIridescenceThicknessMapUv;
#endif
#ifdef USE_SHEEN_COLORMAP
	varying vec2 vSheenColorMapUv;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	varying vec2 vSheenRoughnessMapUv;
#endif
#ifdef USE_SPECULARMAP
	varying vec2 vSpecularMapUv;
#endif
#ifdef USE_SPECULAR_COLORMAP
	varying vec2 vSpecularColorMapUv;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	varying vec2 vSpecularIntensityMapUv;
#endif
#ifdef USE_TRANSMISSIONMAP
	uniform mat3 transmissionMapTransform;
	varying vec2 vTransmissionMapUv;
#endif
#ifdef USE_THICKNESSMAP
	uniform mat3 thicknessMapTransform;
	varying vec2 vThicknessMapUv;
#endif`,Fv=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	varying vec2 vUv;
#endif
#ifdef USE_MAP
	uniform mat3 mapTransform;
	varying vec2 vMapUv;
#endif
#ifdef USE_ALPHAMAP
	uniform mat3 alphaMapTransform;
	varying vec2 vAlphaMapUv;
#endif
#ifdef USE_LIGHTMAP
	uniform mat3 lightMapTransform;
	varying vec2 vLightMapUv;
#endif
#ifdef USE_AOMAP
	uniform mat3 aoMapTransform;
	varying vec2 vAoMapUv;
#endif
#ifdef USE_BUMPMAP
	uniform mat3 bumpMapTransform;
	varying vec2 vBumpMapUv;
#endif
#ifdef USE_NORMALMAP
	uniform mat3 normalMapTransform;
	varying vec2 vNormalMapUv;
#endif
#ifdef USE_DISPLACEMENTMAP
	uniform mat3 displacementMapTransform;
	varying vec2 vDisplacementMapUv;
#endif
#ifdef USE_EMISSIVEMAP
	uniform mat3 emissiveMapTransform;
	varying vec2 vEmissiveMapUv;
#endif
#ifdef USE_METALNESSMAP
	uniform mat3 metalnessMapTransform;
	varying vec2 vMetalnessMapUv;
#endif
#ifdef USE_ROUGHNESSMAP
	uniform mat3 roughnessMapTransform;
	varying vec2 vRoughnessMapUv;
#endif
#ifdef USE_ANISOTROPYMAP
	uniform mat3 anisotropyMapTransform;
	varying vec2 vAnisotropyMapUv;
#endif
#ifdef USE_CLEARCOATMAP
	uniform mat3 clearcoatMapTransform;
	varying vec2 vClearcoatMapUv;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform mat3 clearcoatNormalMapTransform;
	varying vec2 vClearcoatNormalMapUv;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform mat3 clearcoatRoughnessMapTransform;
	varying vec2 vClearcoatRoughnessMapUv;
#endif
#ifdef USE_SHEEN_COLORMAP
	uniform mat3 sheenColorMapTransform;
	varying vec2 vSheenColorMapUv;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	uniform mat3 sheenRoughnessMapTransform;
	varying vec2 vSheenRoughnessMapUv;
#endif
#ifdef USE_IRIDESCENCEMAP
	uniform mat3 iridescenceMapTransform;
	varying vec2 vIridescenceMapUv;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform mat3 iridescenceThicknessMapTransform;
	varying vec2 vIridescenceThicknessMapUv;
#endif
#ifdef USE_SPECULARMAP
	uniform mat3 specularMapTransform;
	varying vec2 vSpecularMapUv;
#endif
#ifdef USE_SPECULAR_COLORMAP
	uniform mat3 specularColorMapTransform;
	varying vec2 vSpecularColorMapUv;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	uniform mat3 specularIntensityMapTransform;
	varying vec2 vSpecularIntensityMapUv;
#endif
#ifdef USE_TRANSMISSIONMAP
	uniform mat3 transmissionMapTransform;
	varying vec2 vTransmissionMapUv;
#endif
#ifdef USE_THICKNESSMAP
	uniform mat3 thicknessMapTransform;
	varying vec2 vThicknessMapUv;
#endif`,Ov=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	vUv = vec3( uv, 1 ).xy;
#endif
#ifdef USE_MAP
	vMapUv = ( mapTransform * vec3( MAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ALPHAMAP
	vAlphaMapUv = ( alphaMapTransform * vec3( ALPHAMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_LIGHTMAP
	vLightMapUv = ( lightMapTransform * vec3( LIGHTMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_AOMAP
	vAoMapUv = ( aoMapTransform * vec3( AOMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_BUMPMAP
	vBumpMapUv = ( bumpMapTransform * vec3( BUMPMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_NORMALMAP
	vNormalMapUv = ( normalMapTransform * vec3( NORMALMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_DISPLACEMENTMAP
	vDisplacementMapUv = ( displacementMapTransform * vec3( DISPLACEMENTMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_EMISSIVEMAP
	vEmissiveMapUv = ( emissiveMapTransform * vec3( EMISSIVEMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_METALNESSMAP
	vMetalnessMapUv = ( metalnessMapTransform * vec3( METALNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ROUGHNESSMAP
	vRoughnessMapUv = ( roughnessMapTransform * vec3( ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ANISOTROPYMAP
	vAnisotropyMapUv = ( anisotropyMapTransform * vec3( ANISOTROPYMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOATMAP
	vClearcoatMapUv = ( clearcoatMapTransform * vec3( CLEARCOATMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	vClearcoatNormalMapUv = ( clearcoatNormalMapTransform * vec3( CLEARCOAT_NORMALMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	vClearcoatRoughnessMapUv = ( clearcoatRoughnessMapTransform * vec3( CLEARCOAT_ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_IRIDESCENCEMAP
	vIridescenceMapUv = ( iridescenceMapTransform * vec3( IRIDESCENCEMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	vIridescenceThicknessMapUv = ( iridescenceThicknessMapTransform * vec3( IRIDESCENCE_THICKNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SHEEN_COLORMAP
	vSheenColorMapUv = ( sheenColorMapTransform * vec3( SHEEN_COLORMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	vSheenRoughnessMapUv = ( sheenRoughnessMapTransform * vec3( SHEEN_ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULARMAP
	vSpecularMapUv = ( specularMapTransform * vec3( SPECULARMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULAR_COLORMAP
	vSpecularColorMapUv = ( specularColorMapTransform * vec3( SPECULAR_COLORMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	vSpecularIntensityMapUv = ( specularIntensityMapTransform * vec3( SPECULAR_INTENSITYMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_TRANSMISSIONMAP
	vTransmissionMapUv = ( transmissionMapTransform * vec3( TRANSMISSIONMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_THICKNESSMAP
	vThicknessMapUv = ( thicknessMapTransform * vec3( THICKNESSMAP_UV, 1 ) ).xy;
#endif`,Bv=`#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
	vec4 worldPosition = vec4( transformed, 1.0 );
	#ifdef USE_BATCHING
		worldPosition = batchingMatrix * worldPosition;
	#endif
	#ifdef USE_INSTANCING
		worldPosition = instanceMatrix * worldPosition;
	#endif
	worldPosition = modelMatrix * worldPosition;
#endif`;const kv=`varying vec2 vUv;
uniform mat3 uvTransform;
void main() {
	vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	gl_Position = vec4( position.xy, 1.0, 1.0 );
}`,zv=`uniform sampler2D t2D;
uniform float backgroundIntensity;
varying vec2 vUv;
void main() {
	vec4 texColor = texture2D( t2D, vUv );
	#ifdef DECODE_VIDEO_TEXTURE
		texColor = vec4( mix( pow( texColor.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), texColor.rgb * 0.0773993808, vec3( lessThanEqual( texColor.rgb, vec3( 0.04045 ) ) ) ), texColor.w );
	#endif
	texColor.rgb *= backgroundIntensity;
	gl_FragColor = texColor;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,Hv=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,Vv=`#ifdef ENVMAP_TYPE_CUBE
	uniform samplerCube envMap;
#elif defined( ENVMAP_TYPE_CUBE_UV )
	uniform sampler2D envMap;
#endif
uniform float flipEnvMap;
uniform float backgroundBlurriness;
uniform float backgroundIntensity;
uniform mat3 backgroundRotation;
varying vec3 vWorldDirection;
#include <cube_uv_reflection_fragment>
void main() {
	#ifdef ENVMAP_TYPE_CUBE
		vec4 texColor = textureCube( envMap, backgroundRotation * vec3( flipEnvMap * vWorldDirection.x, vWorldDirection.yz ) );
	#elif defined( ENVMAP_TYPE_CUBE_UV )
		vec4 texColor = textureCubeUV( envMap, backgroundRotation * vWorldDirection, backgroundBlurriness );
	#else
		vec4 texColor = vec4( 0.0, 0.0, 0.0, 1.0 );
	#endif
	texColor.rgb *= backgroundIntensity;
	gl_FragColor = texColor;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,Gv=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,Wv=`uniform samplerCube tCube;
uniform float tFlip;
uniform float opacity;
varying vec3 vWorldDirection;
void main() {
	vec4 texColor = textureCube( tCube, vec3( tFlip * vWorldDirection.x, vWorldDirection.yz ) );
	gl_FragColor = texColor;
	gl_FragColor.a *= opacity;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,$v=`#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
varying vec2 vHighPrecisionZW;
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <skinbase_vertex>
	#include <morphinstance_vertex>
	#ifdef USE_DISPLACEMENTMAP
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vHighPrecisionZW = gl_Position.zw;
}`,Xv=`#if DEPTH_PACKING == 3200
	uniform float opacity;
#endif
#include <common>
#include <packing>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
varying vec2 vHighPrecisionZW;
void main() {
	vec4 diffuseColor = vec4( 1.0 );
	#include <clipping_planes_fragment>
	#if DEPTH_PACKING == 3200
		diffuseColor.a = opacity;
	#endif
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <logdepthbuf_fragment>
	float fragCoordZ = 0.5 * vHighPrecisionZW[0] / vHighPrecisionZW[1] + 0.5;
	#if DEPTH_PACKING == 3200
		gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );
	#elif DEPTH_PACKING == 3201
		gl_FragColor = packDepthToRGBA( fragCoordZ );
	#elif DEPTH_PACKING == 3202
		gl_FragColor = vec4( packDepthToRGB( fragCoordZ ), 1.0 );
	#elif DEPTH_PACKING == 3203
		gl_FragColor = vec4( packDepthToRG( fragCoordZ ), 0.0, 1.0 );
	#endif
}`,jv=`#define DISTANCE
varying vec3 vWorldPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <skinbase_vertex>
	#include <morphinstance_vertex>
	#ifdef USE_DISPLACEMENTMAP
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <worldpos_vertex>
	#include <clipping_planes_vertex>
	vWorldPosition = worldPosition.xyz;
}`,qv=`#define DISTANCE
uniform vec3 referencePosition;
uniform float nearDistance;
uniform float farDistance;
varying vec3 vWorldPosition;
#include <common>
#include <packing>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <clipping_planes_pars_fragment>
void main () {
	vec4 diffuseColor = vec4( 1.0 );
	#include <clipping_planes_fragment>
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	float dist = length( vWorldPosition - referencePosition );
	dist = ( dist - nearDistance ) / ( farDistance - nearDistance );
	dist = saturate( dist );
	gl_FragColor = packDepthToRGBA( dist );
}`,Yv=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
}`,Zv=`uniform sampler2D tEquirect;
varying vec3 vWorldDirection;
#include <common>
void main() {
	vec3 direction = normalize( vWorldDirection );
	vec2 sampleUV = equirectUv( direction );
	gl_FragColor = texture2D( tEquirect, sampleUV );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,Kv=`uniform float scale;
attribute float lineDistance;
varying float vLineDistance;
#include <common>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	vLineDistance = scale * lineDistance;
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
}`,Jv=`uniform vec3 diffuse;
uniform float opacity;
uniform float dashSize;
uniform float totalSize;
varying float vLineDistance;
#include <common>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	if ( mod( vLineDistance, totalSize ) > dashSize ) {
		discard;
	}
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,Qv=`#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#if defined ( USE_ENVMAP ) || defined ( USE_SKINNING )
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinbase_vertex>
		#include <skinnormal_vertex>
		#include <defaultnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <fog_vertex>
}`,ey=`uniform vec3 diffuse;
uniform float opacity;
#ifndef FLAT_SHADED
	varying vec3 vNormal;
#endif
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		reflectedLight.indirectDiffuse += lightMapTexel.rgb * lightMapIntensity * RECIPROCAL_PI;
	#else
		reflectedLight.indirectDiffuse += vec3( 1.0 );
	#endif
	#include <aomap_fragment>
	reflectedLight.indirectDiffuse *= diffuseColor.rgb;
	vec3 outgoingLight = reflectedLight.indirectDiffuse;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,ty=`#define LAMBERT
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,ny=`#define LAMBERT
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_lambert_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_lambert_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,iy=`#define MATCAP
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <displacementmap_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
	vViewPosition = - mvPosition.xyz;
}`,ry=`#define MATCAP
uniform vec3 diffuse;
uniform float opacity;
uniform sampler2D matcap;
varying vec3 vViewPosition;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <normal_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	vec3 viewDir = normalize( vViewPosition );
	vec3 x = normalize( vec3( viewDir.z, 0.0, - viewDir.x ) );
	vec3 y = cross( viewDir, x );
	vec2 uv = vec2( dot( x, normal ), dot( y, normal ) ) * 0.495 + 0.5;
	#ifdef USE_MATCAP
		vec4 matcapColor = texture2D( matcap, uv );
	#else
		vec4 matcapColor = vec4( vec3( mix( 0.2, 0.8, uv.y ) ), 1.0 );
	#endif
	vec3 outgoingLight = diffuseColor.rgb * matcapColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,sy=`#define NORMAL
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	varying vec3 vViewPosition;
#endif
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	vViewPosition = - mvPosition.xyz;
#endif
}`,oy=`#define NORMAL
uniform float opacity;
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	varying vec3 vViewPosition;
#endif
#include <packing>
#include <uv_pars_fragment>
#include <normal_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( 0.0, 0.0, 0.0, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	gl_FragColor = vec4( packNormalToRGB( normal ), diffuseColor.a );
	#ifdef OPAQUE
		gl_FragColor.a = 1.0;
	#endif
}`,ay=`#define PHONG
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,ly=`#define PHONG
uniform vec3 diffuse;
uniform vec3 emissive;
uniform vec3 specular;
uniform float shininess;
uniform float opacity;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_phong_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_phong_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directSpecular + reflectedLight.indirectSpecular + totalEmissiveRadiance;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,cy=`#define STANDARD
varying vec3 vViewPosition;
#ifdef USE_TRANSMISSION
	varying vec3 vWorldPosition;
#endif
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
#ifdef USE_TRANSMISSION
	vWorldPosition = worldPosition.xyz;
#endif
}`,uy=`#define STANDARD
#ifdef PHYSICAL
	#define IOR
	#define USE_SPECULAR
#endif
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float roughness;
uniform float metalness;
uniform float opacity;
#ifdef IOR
	uniform float ior;
#endif
#ifdef USE_SPECULAR
	uniform float specularIntensity;
	uniform vec3 specularColor;
	#ifdef USE_SPECULAR_COLORMAP
		uniform sampler2D specularColorMap;
	#endif
	#ifdef USE_SPECULAR_INTENSITYMAP
		uniform sampler2D specularIntensityMap;
	#endif
#endif
#ifdef USE_CLEARCOAT
	uniform float clearcoat;
	uniform float clearcoatRoughness;
#endif
#ifdef USE_DISPERSION
	uniform float dispersion;
#endif
#ifdef USE_IRIDESCENCE
	uniform float iridescence;
	uniform float iridescenceIOR;
	uniform float iridescenceThicknessMinimum;
	uniform float iridescenceThicknessMaximum;
#endif
#ifdef USE_SHEEN
	uniform vec3 sheenColor;
	uniform float sheenRoughness;
	#ifdef USE_SHEEN_COLORMAP
		uniform sampler2D sheenColorMap;
	#endif
	#ifdef USE_SHEEN_ROUGHNESSMAP
		uniform sampler2D sheenRoughnessMap;
	#endif
#endif
#ifdef USE_ANISOTROPY
	uniform vec2 anisotropyVector;
	#ifdef USE_ANISOTROPYMAP
		uniform sampler2D anisotropyMap;
	#endif
#endif
varying vec3 vViewPosition;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <iridescence_fragment>
#include <cube_uv_reflection_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_physical_pars_fragment>
#include <fog_pars_fragment>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_physical_pars_fragment>
#include <transmission_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <clearcoat_pars_fragment>
#include <iridescence_pars_fragment>
#include <roughnessmap_pars_fragment>
#include <metalnessmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <roughnessmap_fragment>
	#include <metalnessmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <clearcoat_normal_fragment_begin>
	#include <clearcoat_normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_physical_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 totalDiffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
	vec3 totalSpecular = reflectedLight.directSpecular + reflectedLight.indirectSpecular;
	#include <transmission_fragment>
	vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;
	#ifdef USE_SHEEN
		float sheenEnergyComp = 1.0 - 0.157 * max3( material.sheenColor );
		outgoingLight = outgoingLight * sheenEnergyComp + sheenSpecularDirect + sheenSpecularIndirect;
	#endif
	#ifdef USE_CLEARCOAT
		float dotNVcc = saturate( dot( geometryClearcoatNormal, geometryViewDir ) );
		vec3 Fcc = F_Schlick( material.clearcoatF0, material.clearcoatF90, dotNVcc );
		outgoingLight = outgoingLight * ( 1.0 - material.clearcoat * Fcc ) + ( clearcoatSpecularDirect + clearcoatSpecularIndirect ) * material.clearcoat;
	#endif
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,dy=`#define TOON
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,hy=`#define TOON
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <gradientmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_toon_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_toon_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,fy=`uniform float size;
uniform float scale;
#include <common>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
#ifdef USE_POINTS_UV
	varying vec2 vUv;
	uniform mat3 uvTransform;
#endif
void main() {
	#ifdef USE_POINTS_UV
		vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	#endif
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <project_vertex>
	gl_PointSize = size;
	#ifdef USE_SIZEATTENUATION
		bool isPerspective = isPerspectiveMatrix( projectionMatrix );
		if ( isPerspective ) gl_PointSize *= ( scale / - mvPosition.z );
	#endif
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <worldpos_vertex>
	#include <fog_vertex>
}`,py=`uniform vec3 diffuse;
uniform float opacity;
#include <common>
#include <color_pars_fragment>
#include <map_particle_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_particle_fragment>
	#include <color_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,my=`#include <common>
#include <batching_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <shadowmap_pars_vertex>
void main() {
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,gy=`uniform vec3 color;
uniform float opacity;
#include <common>
#include <packing>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <logdepthbuf_pars_fragment>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
void main() {
	#include <logdepthbuf_fragment>
	gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
}`,_y=`uniform float rotation;
uniform vec2 center;
#include <common>
#include <uv_pars_vertex>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	vec4 mvPosition = modelViewMatrix[ 3 ];
	vec2 scale = vec2( length( modelMatrix[ 0 ].xyz ), length( modelMatrix[ 1 ].xyz ) );
	#ifndef USE_SIZEATTENUATION
		bool isPerspective = isPerspectiveMatrix( projectionMatrix );
		if ( isPerspective ) scale *= - mvPosition.z;
	#endif
	vec2 alignedPosition = ( position.xy - ( center - vec2( 0.5 ) ) ) * scale;
	vec2 rotatedPosition;
	rotatedPosition.x = cos( rotation ) * alignedPosition.x - sin( rotation ) * alignedPosition.y;
	rotatedPosition.y = sin( rotation ) * alignedPosition.x + cos( rotation ) * alignedPosition.y;
	mvPosition.xy += rotatedPosition;
	gl_Position = projectionMatrix * mvPosition;
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
}`,vy=`uniform vec3 diffuse;
uniform float opacity;
#include <common>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
}`,it={alphahash_fragment:z0,alphahash_pars_fragment:H0,alphamap_fragment:V0,alphamap_pars_fragment:G0,alphatest_fragment:W0,alphatest_pars_fragment:$0,aomap_fragment:X0,aomap_pars_fragment:j0,batching_pars_vertex:q0,batching_vertex:Y0,begin_vertex:Z0,beginnormal_vertex:K0,bsdfs:J0,iridescence_fragment:Q0,bumpmap_pars_fragment:e_,clipping_planes_fragment:t_,clipping_planes_pars_fragment:n_,clipping_planes_pars_vertex:i_,clipping_planes_vertex:r_,color_fragment:s_,color_pars_fragment:o_,color_pars_vertex:a_,color_vertex:l_,common:c_,cube_uv_reflection_fragment:u_,defaultnormal_vertex:d_,displacementmap_pars_vertex:h_,displacementmap_vertex:f_,emissivemap_fragment:p_,emissivemap_pars_fragment:m_,colorspace_fragment:g_,colorspace_pars_fragment:__,envmap_fragment:v_,envmap_common_pars_fragment:y_,envmap_pars_fragment:x_,envmap_pars_vertex:b_,envmap_physical_pars_fragment:I_,envmap_vertex:S_,fog_vertex:M_,fog_pars_vertex:w_,fog_fragment:E_,fog_pars_fragment:T_,gradientmap_pars_fragment:A_,lightmap_pars_fragment:C_,lights_lambert_fragment:P_,lights_lambert_pars_fragment:R_,lights_pars_begin:L_,lights_toon_fragment:D_,lights_toon_pars_fragment:N_,lights_phong_fragment:U_,lights_phong_pars_fragment:F_,lights_physical_fragment:O_,lights_physical_pars_fragment:B_,lights_fragment_begin:k_,lights_fragment_maps:z_,lights_fragment_end:H_,logdepthbuf_fragment:V_,logdepthbuf_pars_fragment:G_,logdepthbuf_pars_vertex:W_,logdepthbuf_vertex:$_,map_fragment:X_,map_pars_fragment:j_,map_particle_fragment:q_,map_particle_pars_fragment:Y_,metalnessmap_fragment:Z_,metalnessmap_pars_fragment:K_,morphinstance_vertex:J_,morphcolor_vertex:Q_,morphnormal_vertex:ev,morphtarget_pars_vertex:tv,morphtarget_vertex:nv,normal_fragment_begin:iv,normal_fragment_maps:rv,normal_pars_fragment:sv,normal_pars_vertex:ov,normal_vertex:av,normalmap_pars_fragment:lv,clearcoat_normal_fragment_begin:cv,clearcoat_normal_fragment_maps:uv,clearcoat_pars_fragment:dv,iridescence_pars_fragment:hv,opaque_fragment:fv,packing:pv,premultiplied_alpha_fragment:mv,project_vertex:gv,dithering_fragment:_v,dithering_pars_fragment:vv,roughnessmap_fragment:yv,roughnessmap_pars_fragment:xv,shadowmap_pars_fragment:bv,shadowmap_pars_vertex:Sv,shadowmap_vertex:Mv,shadowmask_pars_fragment:wv,skinbase_vertex:Ev,skinning_pars_vertex:Tv,skinning_vertex:Av,skinnormal_vertex:Cv,specularmap_fragment:Pv,specularmap_pars_fragment:Rv,tonemapping_fragment:Lv,tonemapping_pars_fragment:Iv,transmission_fragment:Dv,transmission_pars_fragment:Nv,uv_pars_fragment:Uv,uv_pars_vertex:Fv,uv_vertex:Ov,worldpos_vertex:Bv,background_vert:kv,background_frag:zv,backgroundCube_vert:Hv,backgroundCube_frag:Vv,cube_vert:Gv,cube_frag:Wv,depth_vert:$v,depth_frag:Xv,distanceRGBA_vert:jv,distanceRGBA_frag:qv,equirect_vert:Yv,equirect_frag:Zv,linedashed_vert:Kv,linedashed_frag:Jv,meshbasic_vert:Qv,meshbasic_frag:ey,meshlambert_vert:ty,meshlambert_frag:ny,meshmatcap_vert:iy,meshmatcap_frag:ry,meshnormal_vert:sy,meshnormal_frag:oy,meshphong_vert:ay,meshphong_frag:ly,meshphysical_vert:cy,meshphysical_frag:uy,meshtoon_vert:dy,meshtoon_frag:hy,points_vert:fy,points_frag:py,shadow_vert:my,shadow_frag:gy,sprite_vert:_y,sprite_frag:vy},Ce={common:{diffuse:{value:new Ke(16777215)},opacity:{value:1},map:{value:null},mapTransform:{value:new rt},alphaMap:{value:null},alphaMapTransform:{value:new rt},alphaTest:{value:0}},specularmap:{specularMap:{value:null},specularMapTransform:{value:new rt}},envmap:{envMap:{value:null},envMapRotation:{value:new rt},flipEnvMap:{value:-1},reflectivity:{value:1},ior:{value:1.5},refractionRatio:{value:.98}},aomap:{aoMap:{value:null},aoMapIntensity:{value:1},aoMapTransform:{value:new rt}},lightmap:{lightMap:{value:null},lightMapIntensity:{value:1},lightMapTransform:{value:new rt}},bumpmap:{bumpMap:{value:null},bumpMapTransform:{value:new rt},bumpScale:{value:1}},normalmap:{normalMap:{value:null},normalMapTransform:{value:new rt},normalScale:{value:new Xe(1,1)}},displacementmap:{displacementMap:{value:null},displacementMapTransform:{value:new rt},displacementScale:{value:1},displacementBias:{value:0}},emissivemap:{emissiveMap:{value:null},emissiveMapTransform:{value:new rt}},metalnessmap:{metalnessMap:{value:null},metalnessMapTransform:{value:new rt}},roughnessmap:{roughnessMap:{value:null},roughnessMapTransform:{value:new rt}},gradientmap:{gradientMap:{value:null}},fog:{fogDensity:{value:25e-5},fogNear:{value:1},fogFar:{value:2e3},fogColor:{value:new Ke(16777215)}},lights:{ambientLightColor:{value:[]},lightProbe:{value:[]},directionalLights:{value:[],properties:{direction:{},color:{}}},directionalLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},directionalShadowMap:{value:[]},directionalShadowMatrix:{value:[]},spotLights:{value:[],properties:{color:{},position:{},direction:{},distance:{},coneCos:{},penumbraCos:{},decay:{}}},spotLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},spotLightMap:{value:[]},spotShadowMap:{value:[]},spotLightMatrix:{value:[]},pointLights:{value:[],properties:{color:{},position:{},decay:{},distance:{}}},pointLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{},shadowCameraNear:{},shadowCameraFar:{}}},pointShadowMap:{value:[]},pointShadowMatrix:{value:[]},hemisphereLights:{value:[],properties:{direction:{},skyColor:{},groundColor:{}}},rectAreaLights:{value:[],properties:{color:{},position:{},width:{},height:{}}},ltc_1:{value:null},ltc_2:{value:null}},points:{diffuse:{value:new Ke(16777215)},opacity:{value:1},size:{value:1},scale:{value:1},map:{value:null},alphaMap:{value:null},alphaMapTransform:{value:new rt},alphaTest:{value:0},uvTransform:{value:new rt}},sprite:{diffuse:{value:new Ke(16777215)},opacity:{value:1},center:{value:new Xe(.5,.5)},rotation:{value:0},map:{value:null},mapTransform:{value:new rt},alphaMap:{value:null},alphaMapTransform:{value:new rt},alphaTest:{value:0}}},si={basic:{uniforms:pn([Ce.common,Ce.specularmap,Ce.envmap,Ce.aomap,Ce.lightmap,Ce.fog]),vertexShader:it.meshbasic_vert,fragmentShader:it.meshbasic_frag},lambert:{uniforms:pn([Ce.common,Ce.specularmap,Ce.envmap,Ce.aomap,Ce.lightmap,Ce.emissivemap,Ce.bumpmap,Ce.normalmap,Ce.displacementmap,Ce.fog,Ce.lights,{emissive:{value:new Ke(0)}}]),vertexShader:it.meshlambert_vert,fragmentShader:it.meshlambert_frag},phong:{uniforms:pn([Ce.common,Ce.specularmap,Ce.envmap,Ce.aomap,Ce.lightmap,Ce.emissivemap,Ce.bumpmap,Ce.normalmap,Ce.displacementmap,Ce.fog,Ce.lights,{emissive:{value:new Ke(0)},specular:{value:new Ke(1118481)},shininess:{value:30}}]),vertexShader:it.meshphong_vert,fragmentShader:it.meshphong_frag},standard:{uniforms:pn([Ce.common,Ce.envmap,Ce.aomap,Ce.lightmap,Ce.emissivemap,Ce.bumpmap,Ce.normalmap,Ce.displacementmap,Ce.roughnessmap,Ce.metalnessmap,Ce.fog,Ce.lights,{emissive:{value:new Ke(0)},roughness:{value:1},metalness:{value:0},envMapIntensity:{value:1}}]),vertexShader:it.meshphysical_vert,fragmentShader:it.meshphysical_frag},toon:{uniforms:pn([Ce.common,Ce.aomap,Ce.lightmap,Ce.emissivemap,Ce.bumpmap,Ce.normalmap,Ce.displacementmap,Ce.gradientmap,Ce.fog,Ce.lights,{emissive:{value:new Ke(0)}}]),vertexShader:it.meshtoon_vert,fragmentShader:it.meshtoon_frag},matcap:{uniforms:pn([Ce.common,Ce.bumpmap,Ce.normalmap,Ce.displacementmap,Ce.fog,{matcap:{value:null}}]),vertexShader:it.meshmatcap_vert,fragmentShader:it.meshmatcap_frag},points:{uniforms:pn([Ce.points,Ce.fog]),vertexShader:it.points_vert,fragmentShader:it.points_frag},dashed:{uniforms:pn([Ce.common,Ce.fog,{scale:{value:1},dashSize:{value:1},totalSize:{value:2}}]),vertexShader:it.linedashed_vert,fragmentShader:it.linedashed_frag},depth:{uniforms:pn([Ce.common,Ce.displacementmap]),vertexShader:it.depth_vert,fragmentShader:it.depth_frag},normal:{uniforms:pn([Ce.common,Ce.bumpmap,Ce.normalmap,Ce.displacementmap,{opacity:{value:1}}]),vertexShader:it.meshnormal_vert,fragmentShader:it.meshnormal_frag},sprite:{uniforms:pn([Ce.sprite,Ce.fog]),vertexShader:it.sprite_vert,fragmentShader:it.sprite_frag},background:{uniforms:{uvTransform:{value:new rt},t2D:{value:null},backgroundIntensity:{value:1}},vertexShader:it.background_vert,fragmentShader:it.background_frag},backgroundCube:{uniforms:{envMap:{value:null},flipEnvMap:{value:-1},backgroundBlurriness:{value:0},backgroundIntensity:{value:1},backgroundRotation:{value:new rt}},vertexShader:it.backgroundCube_vert,fragmentShader:it.backgroundCube_frag},cube:{uniforms:{tCube:{value:null},tFlip:{value:-1},opacity:{value:1}},vertexShader:it.cube_vert,fragmentShader:it.cube_frag},equirect:{uniforms:{tEquirect:{value:null}},vertexShader:it.equirect_vert,fragmentShader:it.equirect_frag},distanceRGBA:{uniforms:pn([Ce.common,Ce.displacementmap,{referencePosition:{value:new z},nearDistance:{value:1},farDistance:{value:1e3}}]),vertexShader:it.distanceRGBA_vert,fragmentShader:it.distanceRGBA_frag},shadow:{uniforms:pn([Ce.lights,Ce.fog,{color:{value:new Ke(0)},opacity:{value:1}}]),vertexShader:it.shadow_vert,fragmentShader:it.shadow_frag}};si.physical={uniforms:pn([si.standard.uniforms,{clearcoat:{value:0},clearcoatMap:{value:null},clearcoatMapTransform:{value:new rt},clearcoatNormalMap:{value:null},clearcoatNormalMapTransform:{value:new rt},clearcoatNormalScale:{value:new Xe(1,1)},clearcoatRoughness:{value:0},clearcoatRoughnessMap:{value:null},clearcoatRoughnessMapTransform:{value:new rt},dispersion:{value:0},iridescence:{value:0},iridescenceMap:{value:null},iridescenceMapTransform:{value:new rt},iridescenceIOR:{value:1.3},iridescenceThicknessMinimum:{value:100},iridescenceThicknessMaximum:{value:400},iridescenceThicknessMap:{value:null},iridescenceThicknessMapTransform:{value:new rt},sheen:{value:0},sheenColor:{value:new Ke(0)},sheenColorMap:{value:null},sheenColorMapTransform:{value:new rt},sheenRoughness:{value:1},sheenRoughnessMap:{value:null},sheenRoughnessMapTransform:{value:new rt},transmission:{value:0},transmissionMap:{value:null},transmissionMapTransform:{value:new rt},transmissionSamplerSize:{value:new Xe},transmissionSamplerMap:{value:null},thickness:{value:0},thicknessMap:{value:null},thicknessMapTransform:{value:new rt},attenuationDistance:{value:0},attenuationColor:{value:new Ke(0)},specularColor:{value:new Ke(1,1,1)},specularColorMap:{value:null},specularColorMapTransform:{value:new rt},specularIntensity:{value:1},specularIntensityMap:{value:null},specularIntensityMapTransform:{value:new rt},anisotropyVector:{value:new Xe},anisotropyMap:{value:null},anisotropyMapTransform:{value:new rt}}]),vertexShader:it.meshphysical_vert,fragmentShader:it.meshphysical_frag};const Yo={r:0,b:0,g:0},pr=new ui,yy=new ht;function xy(n,e,t,i,r,s,o){const a=new Ke(0);let l=s===!0?0:1,c,u,d=null,h=0,f=null;function _(y){let S=y.isScene===!0?y.background:null;return S&&S.isTexture&&(S=(y.backgroundBlurriness>0?t:e).get(S)),S}function v(y){let S=!1;const M=_(y);M===null?m(a,l):M&&M.isColor&&(m(M,1),S=!0);const R=n.xr.getEnvironmentBlendMode();R==="additive"?i.buffers.color.setClear(0,0,0,1,o):R==="alpha-blend"&&i.buffers.color.setClear(0,0,0,0,o),(n.autoClear||S)&&(i.buffers.depth.setTest(!0),i.buffers.depth.setMask(!0),i.buffers.color.setMask(!0),n.clear(n.autoClearColor,n.autoClearDepth,n.autoClearStencil))}function g(y,S){const M=_(S);M&&(M.isCubeTexture||M.mapping===Ga)?(u===void 0&&(u=new gn(new Cs(1,1,1),new Dn({name:"BackgroundCubeMaterial",uniforms:ws(si.backgroundCube.uniforms),vertexShader:si.backgroundCube.vertexShader,fragmentShader:si.backgroundCube.fragmentShader,side:un,depthTest:!1,depthWrite:!1,fog:!1})),u.geometry.deleteAttribute("normal"),u.geometry.deleteAttribute("uv"),u.onBeforeRender=function(R,A,C){this.matrixWorld.copyPosition(C.matrixWorld)},Object.defineProperty(u.material,"envMap",{get:function(){return this.uniforms.envMap.value}}),r.update(u)),pr.copy(S.backgroundRotation),pr.x*=-1,pr.y*=-1,pr.z*=-1,M.isCubeTexture&&M.isRenderTargetTexture===!1&&(pr.y*=-1,pr.z*=-1),u.material.uniforms.envMap.value=M,u.material.uniforms.flipEnvMap.value=M.isCubeTexture&&M.isRenderTargetTexture===!1?-1:1,u.material.uniforms.backgroundBlurriness.value=S.backgroundBlurriness,u.material.uniforms.backgroundIntensity.value=S.backgroundIntensity,u.material.uniforms.backgroundRotation.value.setFromMatrix4(yy.makeRotationFromEuler(pr)),u.material.toneMapped=ft.getTransfer(M.colorSpace)!==bt,(d!==M||h!==M.version||f!==n.toneMapping)&&(u.material.needsUpdate=!0,d=M,h=M.version,f=n.toneMapping),u.layers.enableAll(),y.unshift(u,u.geometry,u.material,0,0,null)):M&&M.isTexture&&(c===void 0&&(c=new gn(new $a(2,2),new Dn({name:"BackgroundMaterial",uniforms:ws(si.background.uniforms),vertexShader:si.background.vertexShader,fragmentShader:si.background.fragmentShader,side:In,depthTest:!1,depthWrite:!1,fog:!1})),c.geometry.deleteAttribute("normal"),Object.defineProperty(c.material,"map",{get:function(){return this.uniforms.t2D.value}}),r.update(c)),c.material.uniforms.t2D.value=M,c.material.uniforms.backgroundIntensity.value=S.backgroundIntensity,c.material.toneMapped=ft.getTransfer(M.colorSpace)!==bt,M.matrixAutoUpdate===!0&&M.updateMatrix(),c.material.uniforms.uvTransform.value.copy(M.matrix),(d!==M||h!==M.version||f!==n.toneMapping)&&(c.material.needsUpdate=!0,d=M,h=M.version,f=n.toneMapping),c.layers.enableAll(),y.unshift(c,c.geometry,c.material,0,0,null))}function m(y,S){y.getRGB(Yo,up(n)),i.buffers.color.setClear(Yo.r,Yo.g,Yo.b,S,o)}return{getClearColor:function(){return a},setClearColor:function(y,S=1){a.set(y),l=S,m(a,l)},getClearAlpha:function(){return l},setClearAlpha:function(y){l=y,m(a,l)},render:v,addToRenderList:g}}function by(n,e){const t=n.getParameter(n.MAX_VERTEX_ATTRIBS),i={},r=h(null);let s=r,o=!1;function a(b,E,F,O,X){let re=!1;const K=d(O,F,E);s!==K&&(s=K,c(s.object)),re=f(b,O,F,X),re&&_(b,O,F,X),X!==null&&e.update(X,n.ELEMENT_ARRAY_BUFFER),(re||o)&&(o=!1,M(b,E,F,O),X!==null&&n.bindBuffer(n.ELEMENT_ARRAY_BUFFER,e.get(X).buffer))}function l(){return n.createVertexArray()}function c(b){return n.bindVertexArray(b)}function u(b){return n.deleteVertexArray(b)}function d(b,E,F){const O=F.wireframe===!0;let X=i[b.id];X===void 0&&(X={},i[b.id]=X);let re=X[E.id];re===void 0&&(re={},X[E.id]=re);let K=re[O];return K===void 0&&(K=h(l()),re[O]=K),K}function h(b){const E=[],F=[],O=[];for(let X=0;X<t;X++)E[X]=0,F[X]=0,O[X]=0;return{geometry:null,program:null,wireframe:!1,newAttributes:E,enabledAttributes:F,attributeDivisors:O,object:b,attributes:{},index:null}}function f(b,E,F,O){const X=s.attributes,re=E.attributes;let K=0;const he=F.getAttributes();for(const j in he)if(he[j].location>=0){const _e=X[j];let Se=re[j];if(Se===void 0&&(j==="instanceMatrix"&&b.instanceMatrix&&(Se=b.instanceMatrix),j==="instanceColor"&&b.instanceColor&&(Se=b.instanceColor)),_e===void 0||_e.attribute!==Se||Se&&_e.data!==Se.data)return!0;K++}return s.attributesNum!==K||s.index!==O}function _(b,E,F,O){const X={},re=E.attributes;let K=0;const he=F.getAttributes();for(const j in he)if(he[j].location>=0){let _e=re[j];_e===void 0&&(j==="instanceMatrix"&&b.instanceMatrix&&(_e=b.instanceMatrix),j==="instanceColor"&&b.instanceColor&&(_e=b.instanceColor));const Se={};Se.attribute=_e,_e&&_e.data&&(Se.data=_e.data),X[j]=Se,K++}s.attributes=X,s.attributesNum=K,s.index=O}function v(){const b=s.newAttributes;for(let E=0,F=b.length;E<F;E++)b[E]=0}function g(b){m(b,0)}function m(b,E){const F=s.newAttributes,O=s.enabledAttributes,X=s.attributeDivisors;F[b]=1,O[b]===0&&(n.enableVertexAttribArray(b),O[b]=1),X[b]!==E&&(n.vertexAttribDivisor(b,E),X[b]=E)}function y(){const b=s.newAttributes,E=s.enabledAttributes;for(let F=0,O=E.length;F<O;F++)E[F]!==b[F]&&(n.disableVertexAttribArray(F),E[F]=0)}function S(b,E,F,O,X,re,K){K===!0?n.vertexAttribIPointer(b,E,F,X,re):n.vertexAttribPointer(b,E,F,O,X,re)}function M(b,E,F,O){v();const X=O.attributes,re=F.getAttributes(),K=E.defaultAttributeValues;for(const he in re){const j=re[he];if(j.location>=0){let Ee=X[he];if(Ee===void 0&&(he==="instanceMatrix"&&b.instanceMatrix&&(Ee=b.instanceMatrix),he==="instanceColor"&&b.instanceColor&&(Ee=b.instanceColor)),Ee!==void 0){const _e=Ee.normalized,Se=Ee.itemSize,Me=e.get(Ee);if(Me===void 0)continue;const ze=Me.buffer,ue=Me.type,me=Me.bytesPerElement,we=ue===n.INT||ue===n.UNSIGNED_INT||Ee.gpuType===bu;if(Ee.isInterleavedBufferAttribute){const ye=Ee.data,Ve=ye.stride,Ne=Ee.offset;if(ye.isInstancedInterleavedBuffer){for(let qe=0;qe<j.locationSize;qe++)m(j.location+qe,ye.meshPerAttribute);b.isInstancedMesh!==!0&&O._maxInstanceCount===void 0&&(O._maxInstanceCount=ye.meshPerAttribute*ye.count)}else for(let qe=0;qe<j.locationSize;qe++)g(j.location+qe);n.bindBuffer(n.ARRAY_BUFFER,ze);for(let qe=0;qe<j.locationSize;qe++)S(j.location+qe,Se/j.locationSize,ue,_e,Ve*me,(Ne+Se/j.locationSize*qe)*me,we)}else{if(Ee.isInstancedBufferAttribute){for(let ye=0;ye<j.locationSize;ye++)m(j.location+ye,Ee.meshPerAttribute);b.isInstancedMesh!==!0&&O._maxInstanceCount===void 0&&(O._maxInstanceCount=Ee.meshPerAttribute*Ee.count)}else for(let ye=0;ye<j.locationSize;ye++)g(j.location+ye);n.bindBuffer(n.ARRAY_BUFFER,ze);for(let ye=0;ye<j.locationSize;ye++)S(j.location+ye,Se/j.locationSize,ue,_e,Se*me,Se/j.locationSize*ye*me,we)}}else if(K!==void 0){const _e=K[he];if(_e!==void 0)switch(_e.length){case 2:n.vertexAttrib2fv(j.location,_e);break;case 3:n.vertexAttrib3fv(j.location,_e);break;case 4:n.vertexAttrib4fv(j.location,_e);break;default:n.vertexAttrib1fv(j.location,_e)}}}}y()}function R(){D();for(const b in i){const E=i[b];for(const F in E){const O=E[F];for(const X in O)u(O[X].object),delete O[X];delete E[F]}delete i[b]}}function A(b){if(i[b.id]===void 0)return;const E=i[b.id];for(const F in E){const O=E[F];for(const X in O)u(O[X].object),delete O[X];delete E[F]}delete i[b.id]}function C(b){for(const E in i){const F=i[E];if(F[b.id]===void 0)continue;const O=F[b.id];for(const X in O)u(O[X].object),delete O[X];delete F[b.id]}}function D(){$(),o=!0,s!==r&&(s=r,c(s.object))}function $(){r.geometry=null,r.program=null,r.wireframe=!1}return{setup:a,reset:D,resetDefaultState:$,dispose:R,releaseStatesOfGeometry:A,releaseStatesOfProgram:C,initAttributes:v,enableAttribute:g,disableUnusedAttributes:y}}function Sy(n,e,t){let i;function r(c){i=c}function s(c,u){n.drawArrays(i,c,u),t.update(u,i,1)}function o(c,u,d){d!==0&&(n.drawArraysInstanced(i,c,u,d),t.update(u,i,d))}function a(c,u,d){if(d===0)return;e.get("WEBGL_multi_draw").multiDrawArraysWEBGL(i,c,0,u,0,d);let f=0;for(let _=0;_<d;_++)f+=u[_];t.update(f,i,1)}function l(c,u,d,h){if(d===0)return;const f=e.get("WEBGL_multi_draw");if(f===null)for(let _=0;_<c.length;_++)o(c[_],u[_],h[_]);else{f.multiDrawArraysInstancedWEBGL(i,c,0,u,0,h,0,d);let _=0;for(let v=0;v<d;v++)_+=u[v];for(let v=0;v<h.length;v++)t.update(_,i,h[v])}}this.setMode=r,this.render=s,this.renderInstances=o,this.renderMultiDraw=a,this.renderMultiDrawInstances=l}function My(n,e,t,i){let r;function s(){if(r!==void 0)return r;if(e.has("EXT_texture_filter_anisotropic")===!0){const C=e.get("EXT_texture_filter_anisotropic");r=n.getParameter(C.MAX_TEXTURE_MAX_ANISOTROPY_EXT)}else r=0;return r}function o(C){return!(C!==Vn&&i.convert(C)!==n.getParameter(n.IMPLEMENTATION_COLOR_READ_FORMAT))}function a(C){const D=C===mo&&(e.has("EXT_color_buffer_half_float")||e.has("EXT_color_buffer_float"));return!(C!==ci&&i.convert(C)!==n.getParameter(n.IMPLEMENTATION_COLOR_READ_TYPE)&&C!==Ai&&!D)}function l(C){if(C==="highp"){if(n.getShaderPrecisionFormat(n.VERTEX_SHADER,n.HIGH_FLOAT).precision>0&&n.getShaderPrecisionFormat(n.FRAGMENT_SHADER,n.HIGH_FLOAT).precision>0)return"highp";C="mediump"}return C==="mediump"&&n.getShaderPrecisionFormat(n.VERTEX_SHADER,n.MEDIUM_FLOAT).precision>0&&n.getShaderPrecisionFormat(n.FRAGMENT_SHADER,n.MEDIUM_FLOAT).precision>0?"mediump":"lowp"}let c=t.precision!==void 0?t.precision:"highp";const u=l(c);u!==c&&(console.warn("THREE.WebGLRenderer:",c,"not supported, using",u,"instead."),c=u);const d=t.logarithmicDepthBuffer===!0,h=t.reverseDepthBuffer===!0&&e.has("EXT_clip_control");if(h===!0){const C=e.get("EXT_clip_control");C.clipControlEXT(C.LOWER_LEFT_EXT,C.ZERO_TO_ONE_EXT)}const f=n.getParameter(n.MAX_TEXTURE_IMAGE_UNITS),_=n.getParameter(n.MAX_VERTEX_TEXTURE_IMAGE_UNITS),v=n.getParameter(n.MAX_TEXTURE_SIZE),g=n.getParameter(n.MAX_CUBE_MAP_TEXTURE_SIZE),m=n.getParameter(n.MAX_VERTEX_ATTRIBS),y=n.getParameter(n.MAX_VERTEX_UNIFORM_VECTORS),S=n.getParameter(n.MAX_VARYING_VECTORS),M=n.getParameter(n.MAX_FRAGMENT_UNIFORM_VECTORS),R=_>0,A=n.getParameter(n.MAX_SAMPLES);return{isWebGL2:!0,getMaxAnisotropy:s,getMaxPrecision:l,textureFormatReadable:o,textureTypeReadable:a,precision:c,logarithmicDepthBuffer:d,reverseDepthBuffer:h,maxTextures:f,maxVertexTextures:_,maxTextureSize:v,maxCubemapSize:g,maxAttributes:m,maxVertexUniforms:y,maxVaryings:S,maxFragmentUniforms:M,vertexTextures:R,maxSamples:A}}function wy(n){const e=this;let t=null,i=0,r=!1,s=!1;const o=new ri,a=new rt,l={value:null,needsUpdate:!1};this.uniform=l,this.numPlanes=0,this.numIntersection=0,this.init=function(d,h){const f=d.length!==0||h||i!==0||r;return r=h,i=d.length,f},this.beginShadows=function(){s=!0,u(null)},this.endShadows=function(){s=!1},this.setGlobalState=function(d,h){t=u(d,h,0)},this.setState=function(d,h,f){const _=d.clippingPlanes,v=d.clipIntersection,g=d.clipShadows,m=n.get(d);if(!r||_===null||_.length===0||s&&!g)s?u(null):c();else{const y=s?0:i,S=y*4;let M=m.clippingState||null;l.value=M,M=u(_,h,S,f);for(let R=0;R!==S;++R)M[R]=t[R];m.clippingState=M,this.numIntersection=v?this.numPlanes:0,this.numPlanes+=y}};function c(){l.value!==t&&(l.value=t,l.needsUpdate=i>0),e.numPlanes=i,e.numIntersection=0}function u(d,h,f,_){const v=d!==null?d.length:0;let g=null;if(v!==0){if(g=l.value,_!==!0||g===null){const m=f+v*4,y=h.matrixWorldInverse;a.getNormalMatrix(y),(g===null||g.length<m)&&(g=new Float32Array(m));for(let S=0,M=f;S!==v;++S,M+=4)o.copy(d[S]).applyMatrix4(y,a),o.normal.toArray(g,M),g[M+3]=o.constant}l.value=g,l.needsUpdate=!0}return e.numPlanes=v,e.numIntersection=0,g}}function Ey(n){let e=new WeakMap;function t(o,a){return a===Mc?o.mapping=xs:a===wc&&(o.mapping=bs),o}function i(o){if(o&&o.isTexture){const a=o.mapping;if(a===Mc||a===wc)if(e.has(o)){const l=e.get(o).texture;return t(l,o.mapping)}else{const l=o.image;if(l&&l.height>0){const c=new F0(l.height);return c.fromEquirectangularTexture(n,o),e.set(o,c),o.addEventListener("dispose",r),t(c.texture,o.mapping)}else return null}}return o}function r(o){const a=o.target;a.removeEventListener("dispose",r);const l=e.get(a);l!==void 0&&(e.delete(a),l.dispose())}function s(){e=new WeakMap}return{get:i,dispose:s}}class mp extends dp{constructor(e=-1,t=1,i=1,r=-1,s=.1,o=2e3){super(),this.isOrthographicCamera=!0,this.type="OrthographicCamera",this.zoom=1,this.view=null,this.left=e,this.right=t,this.top=i,this.bottom=r,this.near=s,this.far=o,this.updateProjectionMatrix()}copy(e,t){return super.copy(e,t),this.left=e.left,this.right=e.right,this.top=e.top,this.bottom=e.bottom,this.near=e.near,this.far=e.far,this.zoom=e.zoom,this.view=e.view===null?null:Object.assign({},e.view),this}setViewOffset(e,t,i,r,s,o){this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=e,this.view.fullHeight=t,this.view.offsetX=i,this.view.offsetY=r,this.view.width=s,this.view.height=o,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){const e=(this.right-this.left)/(2*this.zoom),t=(this.top-this.bottom)/(2*this.zoom),i=(this.right+this.left)/2,r=(this.top+this.bottom)/2;let s=i-e,o=i+e,a=r+t,l=r-t;if(this.view!==null&&this.view.enabled){const c=(this.right-this.left)/this.view.fullWidth/this.zoom,u=(this.top-this.bottom)/this.view.fullHeight/this.zoom;s+=c*this.view.offsetX,o=s+c*this.view.width,a-=u*this.view.offsetY,l=a-u*this.view.height}this.projectionMatrix.makeOrthographic(s,o,a,l,this.near,this.far,this.coordinateSystem),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(e){const t=super.toJSON(e);return t.object.zoom=this.zoom,t.object.left=this.left,t.object.right=this.right,t.object.top=this.top,t.object.bottom=this.bottom,t.object.near=this.near,t.object.far=this.far,this.view!==null&&(t.object.view=Object.assign({},this.view)),t}}const hs=4,th=[.125,.215,.35,.446,.526,.582],br=20,Ol=new mp,nh=new Ke;let Bl=null,kl=0,zl=0,Hl=!1;const yr=(1+Math.sqrt(5))/2,Yr=1/yr,ih=[new z(-yr,Yr,0),new z(yr,Yr,0),new z(-Yr,0,yr),new z(Yr,0,yr),new z(0,yr,-Yr),new z(0,yr,Yr),new z(-1,1,-1),new z(1,1,-1),new z(-1,1,1),new z(1,1,1)];class rh{constructor(e){this._renderer=e,this._pingPongRenderTarget=null,this._lodMax=0,this._cubeSize=0,this._lodPlanes=[],this._sizeLods=[],this._sigmas=[],this._blurMaterial=null,this._cubemapMaterial=null,this._equirectMaterial=null,this._compileMaterial(this._blurMaterial)}fromScene(e,t=0,i=.1,r=100){Bl=this._renderer.getRenderTarget(),kl=this._renderer.getActiveCubeFace(),zl=this._renderer.getActiveMipmapLevel(),Hl=this._renderer.xr.enabled,this._renderer.xr.enabled=!1,this._setSize(256);const s=this._allocateTargets();return s.depthBuffer=!0,this._sceneToCubeUV(e,i,r,s),t>0&&this._blur(s,0,0,t),this._applyPMREM(s),this._cleanup(s),s}fromEquirectangular(e,t=null){return this._fromTexture(e,t)}fromCubemap(e,t=null){return this._fromTexture(e,t)}compileCubemapShader(){this._cubemapMaterial===null&&(this._cubemapMaterial=ah(),this._compileMaterial(this._cubemapMaterial))}compileEquirectangularShader(){this._equirectMaterial===null&&(this._equirectMaterial=oh(),this._compileMaterial(this._equirectMaterial))}dispose(){this._dispose(),this._cubemapMaterial!==null&&this._cubemapMaterial.dispose(),this._equirectMaterial!==null&&this._equirectMaterial.dispose()}_setSize(e){this._lodMax=Math.floor(Math.log2(e)),this._cubeSize=Math.pow(2,this._lodMax)}_dispose(){this._blurMaterial!==null&&this._blurMaterial.dispose(),this._pingPongRenderTarget!==null&&this._pingPongRenderTarget.dispose();for(let e=0;e<this._lodPlanes.length;e++)this._lodPlanes[e].dispose()}_cleanup(e){this._renderer.setRenderTarget(Bl,kl,zl),this._renderer.xr.enabled=Hl,e.scissorTest=!1,Zo(e,0,0,e.width,e.height)}_fromTexture(e,t){e.mapping===xs||e.mapping===bs?this._setSize(e.image.length===0?16:e.image[0].width||e.image[0].image.width):this._setSize(e.image.width/4),Bl=this._renderer.getRenderTarget(),kl=this._renderer.getActiveCubeFace(),zl=this._renderer.getActiveMipmapLevel(),Hl=this._renderer.xr.enabled,this._renderer.xr.enabled=!1;const i=t||this._allocateTargets();return this._textureToCubeUV(e,i),this._applyPMREM(i),this._cleanup(i),i}_allocateTargets(){const e=3*Math.max(this._cubeSize,112),t=4*this._cubeSize,i={magFilter:zn,minFilter:zn,generateMipmaps:!1,type:mo,format:Vn,colorSpace:rr,depthBuffer:!1},r=sh(e,t,i);if(this._pingPongRenderTarget===null||this._pingPongRenderTarget.width!==e||this._pingPongRenderTarget.height!==t){this._pingPongRenderTarget!==null&&this._dispose(),this._pingPongRenderTarget=sh(e,t,i);const{_lodMax:s}=this;({sizeLods:this._sizeLods,lodPlanes:this._lodPlanes,sigmas:this._sigmas}=Ty(s)),this._blurMaterial=Ay(s,e,t)}return r}_compileMaterial(e){const t=new gn(this._lodPlanes[0],e);this._renderer.compile(t,Ol)}_sceneToCubeUV(e,t,i,r){const a=new kn(90,1,t,i),l=[1,-1,1,1,1,1],c=[1,1,1,-1,-1,-1],u=this._renderer,d=u.autoClear,h=u.toneMapping;u.getClearColor(nh),u.toneMapping=tr,u.autoClear=!1;const f=new Lu({name:"PMREM.Background",side:un,depthWrite:!1,depthTest:!1}),_=new gn(new Cs,f);let v=!1;const g=e.background;g?g.isColor&&(f.color.copy(g),e.background=null,v=!0):(f.color.copy(nh),v=!0);for(let m=0;m<6;m++){const y=m%3;y===0?(a.up.set(0,l[m],0),a.lookAt(c[m],0,0)):y===1?(a.up.set(0,0,l[m]),a.lookAt(0,c[m],0)):(a.up.set(0,l[m],0),a.lookAt(0,0,c[m]));const S=this._cubeSize;Zo(r,y*S,m>2?S:0,S,S),u.setRenderTarget(r),v&&u.render(_,a),u.render(e,a)}_.geometry.dispose(),_.material.dispose(),u.toneMapping=h,u.autoClear=d,e.background=g}_textureToCubeUV(e,t){const i=this._renderer,r=e.mapping===xs||e.mapping===bs;r?(this._cubemapMaterial===null&&(this._cubemapMaterial=ah()),this._cubemapMaterial.uniforms.flipEnvMap.value=e.isRenderTargetTexture===!1?-1:1):this._equirectMaterial===null&&(this._equirectMaterial=oh());const s=r?this._cubemapMaterial:this._equirectMaterial,o=new gn(this._lodPlanes[0],s),a=s.uniforms;a.envMap.value=e;const l=this._cubeSize;Zo(t,0,0,3*l,2*l),i.setRenderTarget(t),i.render(o,Ol)}_applyPMREM(e){const t=this._renderer,i=t.autoClear;t.autoClear=!1;const r=this._lodPlanes.length;for(let s=1;s<r;s++){const o=Math.sqrt(this._sigmas[s]*this._sigmas[s]-this._sigmas[s-1]*this._sigmas[s-1]),a=ih[(r-s-1)%ih.length];this._blur(e,s-1,s,o,a)}t.autoClear=i}_blur(e,t,i,r,s){const o=this._pingPongRenderTarget;this._halfBlur(e,o,t,i,r,"latitudinal",s),this._halfBlur(o,e,i,i,r,"longitudinal",s)}_halfBlur(e,t,i,r,s,o,a){const l=this._renderer,c=this._blurMaterial;o!=="latitudinal"&&o!=="longitudinal"&&console.error("blur direction must be either latitudinal or longitudinal!");const u=3,d=new gn(this._lodPlanes[r],c),h=c.uniforms,f=this._sizeLods[i]-1,_=isFinite(s)?Math.PI/(2*f):2*Math.PI/(2*br-1),v=s/_,g=isFinite(s)?1+Math.floor(u*v):br;g>br&&console.warn(`sigmaRadians, ${s}, is too large and will clip, as it requested ${g} samples when the maximum is set to ${br}`);const m=[];let y=0;for(let C=0;C<br;++C){const D=C/v,$=Math.exp(-D*D/2);m.push($),C===0?y+=$:C<g&&(y+=2*$)}for(let C=0;C<m.length;C++)m[C]=m[C]/y;h.envMap.value=e.texture,h.samples.value=g,h.weights.value=m,h.latitudinal.value=o==="latitudinal",a&&(h.poleAxis.value=a);const{_lodMax:S}=this;h.dTheta.value=_,h.mipInt.value=S-i;const M=this._sizeLods[r],R=3*M*(r>S-hs?r-S+hs:0),A=4*(this._cubeSize-M);Zo(t,R,A,3*M,2*M),l.setRenderTarget(t),l.render(d,Ol)}}function Ty(n){const e=[],t=[],i=[];let r=n;const s=n-hs+1+th.length;for(let o=0;o<s;o++){const a=Math.pow(2,r);t.push(a);let l=1/a;o>n-hs?l=th[o-n+hs-1]:o===0&&(l=0),i.push(l);const c=1/(a-2),u=-c,d=1+c,h=[u,u,d,u,d,d,u,u,d,d,u,d],f=6,_=6,v=3,g=2,m=1,y=new Float32Array(v*_*f),S=new Float32Array(g*_*f),M=new Float32Array(m*_*f);for(let A=0;A<f;A++){const C=A%3*2/3-1,D=A>2?0:-1,$=[C,D,0,C+2/3,D,0,C+2/3,D+1,0,C,D,0,C+2/3,D+1,0,C,D+1,0];y.set($,v*_*A),S.set(h,g*_*A);const b=[A,A,A,A,A,A];M.set(b,m*_*A)}const R=new Ct;R.setAttribute("position",new pt(y,v)),R.setAttribute("uv",new pt(S,g)),R.setAttribute("faceIndex",new pt(M,m)),e.push(R),r>hs&&r--}return{lodPlanes:e,sizeLods:t,sigmas:i}}function sh(n,e,t){const i=new nr(n,e,t);return i.texture.mapping=Ga,i.texture.name="PMREM.cubeUv",i.scissorTest=!0,i}function Zo(n,e,t,i,r){n.viewport.set(e,t,i,r),n.scissor.set(e,t,i,r)}function Ay(n,e,t){const i=new Float32Array(br),r=new z(0,1,0);return new Dn({name:"SphericalGaussianBlur",defines:{n:br,CUBEUV_TEXEL_WIDTH:1/e,CUBEUV_TEXEL_HEIGHT:1/t,CUBEUV_MAX_MIP:`${n}.0`},uniforms:{envMap:{value:null},samples:{value:1},weights:{value:i},latitudinal:{value:!1},dTheta:{value:0},mipInt:{value:0},poleAxis:{value:r}},vertexShader:Iu(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;
			uniform int samples;
			uniform float weights[ n ];
			uniform bool latitudinal;
			uniform float dTheta;
			uniform float mipInt;
			uniform vec3 poleAxis;

			#define ENVMAP_TYPE_CUBE_UV
			#include <cube_uv_reflection_fragment>

			vec3 getSample( float theta, vec3 axis ) {

				float cosTheta = cos( theta );
				// Rodrigues' axis-angle rotation
				vec3 sampleDirection = vOutputDirection * cosTheta
					+ cross( axis, vOutputDirection ) * sin( theta )
					+ axis * dot( axis, vOutputDirection ) * ( 1.0 - cosTheta );

				return bilinearCubeUV( envMap, sampleDirection, mipInt );

			}

			void main() {

				vec3 axis = latitudinal ? poleAxis : cross( poleAxis, vOutputDirection );

				if ( all( equal( axis, vec3( 0.0 ) ) ) ) {

					axis = vec3( vOutputDirection.z, 0.0, - vOutputDirection.x );

				}

				axis = normalize( axis );

				gl_FragColor = vec4( 0.0, 0.0, 0.0, 1.0 );
				gl_FragColor.rgb += weights[ 0 ] * getSample( 0.0, axis );

				for ( int i = 1; i < n; i++ ) {

					if ( i >= samples ) {

						break;

					}

					float theta = dTheta * float( i );
					gl_FragColor.rgb += weights[ i ] * getSample( -1.0 * theta, axis );
					gl_FragColor.rgb += weights[ i ] * getSample( theta, axis );

				}

			}
		`,blending:er,depthTest:!1,depthWrite:!1})}function oh(){return new Dn({name:"EquirectangularToCubeUV",uniforms:{envMap:{value:null}},vertexShader:Iu(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;

			#include <common>

			void main() {

				vec3 outputDirection = normalize( vOutputDirection );
				vec2 uv = equirectUv( outputDirection );

				gl_FragColor = vec4( texture2D ( envMap, uv ).rgb, 1.0 );

			}
		`,blending:er,depthTest:!1,depthWrite:!1})}function ah(){return new Dn({name:"CubemapToCubeUV",uniforms:{envMap:{value:null},flipEnvMap:{value:-1}},vertexShader:Iu(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			uniform float flipEnvMap;

			varying vec3 vOutputDirection;

			uniform samplerCube envMap;

			void main() {

				gl_FragColor = textureCube( envMap, vec3( flipEnvMap * vOutputDirection.x, vOutputDirection.yz ) );

			}
		`,blending:er,depthTest:!1,depthWrite:!1})}function Iu(){return`

		precision mediump float;
		precision mediump int;

		attribute float faceIndex;

		varying vec3 vOutputDirection;

		// RH coordinate system; PMREM face-indexing convention
		vec3 getDirection( vec2 uv, float face ) {

			uv = 2.0 * uv - 1.0;

			vec3 direction = vec3( uv, 1.0 );

			if ( face == 0.0 ) {

				direction = direction.zyx; // ( 1, v, u ) pos x

			} else if ( face == 1.0 ) {

				direction = direction.xzy;
				direction.xz *= -1.0; // ( -u, 1, -v ) pos y

			} else if ( face == 2.0 ) {

				direction.x *= -1.0; // ( -u, v, 1 ) pos z

			} else if ( face == 3.0 ) {

				direction = direction.zyx;
				direction.xz *= -1.0; // ( -1, v, -u ) neg x

			} else if ( face == 4.0 ) {

				direction = direction.xzy;
				direction.xy *= -1.0; // ( -u, -1, v ) neg y

			} else if ( face == 5.0 ) {

				direction.z *= -1.0; // ( u, v, -1 ) neg z

			}

			return direction;

		}

		void main() {

			vOutputDirection = getDirection( uv, faceIndex );
			gl_Position = vec4( position, 1.0 );

		}
	`}function Cy(n){let e=new WeakMap,t=null;function i(a){if(a&&a.isTexture){const l=a.mapping,c=l===Mc||l===wc,u=l===xs||l===bs;if(c||u){let d=e.get(a);const h=d!==void 0?d.texture.pmremVersion:0;if(a.isRenderTargetTexture&&a.pmremVersion!==h)return t===null&&(t=new rh(n)),d=c?t.fromEquirectangular(a,d):t.fromCubemap(a,d),d.texture.pmremVersion=a.pmremVersion,e.set(a,d),d.texture;if(d!==void 0)return d.texture;{const f=a.image;return c&&f&&f.height>0||u&&f&&r(f)?(t===null&&(t=new rh(n)),d=c?t.fromEquirectangular(a):t.fromCubemap(a),d.texture.pmremVersion=a.pmremVersion,e.set(a,d),a.addEventListener("dispose",s),d.texture):null}}}return a}function r(a){let l=0;const c=6;for(let u=0;u<c;u++)a[u]!==void 0&&l++;return l===c}function s(a){const l=a.target;l.removeEventListener("dispose",s);const c=e.get(l);c!==void 0&&(e.delete(l),c.dispose())}function o(){e=new WeakMap,t!==null&&(t.dispose(),t=null)}return{get:i,dispose:o}}function Py(n){const e={};function t(i){if(e[i]!==void 0)return e[i];let r;switch(i){case"WEBGL_depth_texture":r=n.getExtension("WEBGL_depth_texture")||n.getExtension("MOZ_WEBGL_depth_texture")||n.getExtension("WEBKIT_WEBGL_depth_texture");break;case"EXT_texture_filter_anisotropic":r=n.getExtension("EXT_texture_filter_anisotropic")||n.getExtension("MOZ_EXT_texture_filter_anisotropic")||n.getExtension("WEBKIT_EXT_texture_filter_anisotropic");break;case"WEBGL_compressed_texture_s3tc":r=n.getExtension("WEBGL_compressed_texture_s3tc")||n.getExtension("MOZ_WEBGL_compressed_texture_s3tc")||n.getExtension("WEBKIT_WEBGL_compressed_texture_s3tc");break;case"WEBGL_compressed_texture_pvrtc":r=n.getExtension("WEBGL_compressed_texture_pvrtc")||n.getExtension("WEBKIT_WEBGL_compressed_texture_pvrtc");break;default:r=n.getExtension(i)}return e[i]=r,r}return{has:function(i){return t(i)!==null},init:function(){t("EXT_color_buffer_float"),t("WEBGL_clip_cull_distance"),t("OES_texture_float_linear"),t("EXT_color_buffer_half_float"),t("WEBGL_multisampled_render_to_texture"),t("WEBGL_render_shared_exponent")},get:function(i){const r=t(i);return r===null&&Pa("THREE.WebGLRenderer: "+i+" extension not supported."),r}}}function Ry(n,e,t,i){const r={},s=new WeakMap;function o(d){const h=d.target;h.index!==null&&e.remove(h.index);for(const _ in h.attributes)e.remove(h.attributes[_]);for(const _ in h.morphAttributes){const v=h.morphAttributes[_];for(let g=0,m=v.length;g<m;g++)e.remove(v[g])}h.removeEventListener("dispose",o),delete r[h.id];const f=s.get(h);f&&(e.remove(f),s.delete(h)),i.releaseStatesOfGeometry(h),h.isInstancedBufferGeometry===!0&&delete h._maxInstanceCount,t.memory.geometries--}function a(d,h){return r[h.id]===!0||(h.addEventListener("dispose",o),r[h.id]=!0,t.memory.geometries++),h}function l(d){const h=d.attributes;for(const _ in h)e.update(h[_],n.ARRAY_BUFFER);const f=d.morphAttributes;for(const _ in f){const v=f[_];for(let g=0,m=v.length;g<m;g++)e.update(v[g],n.ARRAY_BUFFER)}}function c(d){const h=[],f=d.index,_=d.attributes.position;let v=0;if(f!==null){const y=f.array;v=f.version;for(let S=0,M=y.length;S<M;S+=3){const R=y[S+0],A=y[S+1],C=y[S+2];h.push(R,A,A,C,C,R)}}else if(_!==void 0){const y=_.array;v=_.version;for(let S=0,M=y.length/3-1;S<M;S+=3){const R=S+0,A=S+1,C=S+2;h.push(R,A,A,C,C,R)}}else return;const g=new(sp(h)?cp:lp)(h,1);g.version=v;const m=s.get(d);m&&e.remove(m),s.set(d,g)}function u(d){const h=s.get(d);if(h){const f=d.index;f!==null&&h.version<f.version&&c(d)}else c(d);return s.get(d)}return{get:a,update:l,getWireframeAttribute:u}}function Ly(n,e,t){let i;function r(h){i=h}let s,o;function a(h){s=h.type,o=h.bytesPerElement}function l(h,f){n.drawElements(i,f,s,h*o),t.update(f,i,1)}function c(h,f,_){_!==0&&(n.drawElementsInstanced(i,f,s,h*o,_),t.update(f,i,_))}function u(h,f,_){if(_===0)return;e.get("WEBGL_multi_draw").multiDrawElementsWEBGL(i,f,0,s,h,0,_);let g=0;for(let m=0;m<_;m++)g+=f[m];t.update(g,i,1)}function d(h,f,_,v){if(_===0)return;const g=e.get("WEBGL_multi_draw");if(g===null)for(let m=0;m<h.length;m++)c(h[m]/o,f[m],v[m]);else{g.multiDrawElementsInstancedWEBGL(i,f,0,s,h,0,v,0,_);let m=0;for(let y=0;y<_;y++)m+=f[y];for(let y=0;y<v.length;y++)t.update(m,i,v[y])}}this.setMode=r,this.setIndex=a,this.render=l,this.renderInstances=c,this.renderMultiDraw=u,this.renderMultiDrawInstances=d}function Iy(n){const e={geometries:0,textures:0},t={frame:0,calls:0,triangles:0,points:0,lines:0};function i(s,o,a){switch(t.calls++,o){case n.TRIANGLES:t.triangles+=a*(s/3);break;case n.LINES:t.lines+=a*(s/2);break;case n.LINE_STRIP:t.lines+=a*(s-1);break;case n.LINE_LOOP:t.lines+=a*s;break;case n.POINTS:t.points+=a*s;break;default:console.error("THREE.WebGLInfo: Unknown draw mode:",o);break}}function r(){t.calls=0,t.triangles=0,t.points=0,t.lines=0}return{memory:e,render:t,programs:null,autoReset:!0,reset:r,update:i}}function Dy(n,e,t){const i=new WeakMap,r=new Rt;function s(o,a,l){const c=o.morphTargetInfluences,u=a.morphAttributes.position||a.morphAttributes.normal||a.morphAttributes.color,d=u!==void 0?u.length:0;let h=i.get(a);if(h===void 0||h.count!==d){let $=function(){C.dispose(),i.delete(a),a.removeEventListener("dispose",$)};h!==void 0&&h.texture.dispose();const f=a.morphAttributes.position!==void 0,_=a.morphAttributes.normal!==void 0,v=a.morphAttributes.color!==void 0,g=a.morphAttributes.position||[],m=a.morphAttributes.normal||[],y=a.morphAttributes.color||[];let S=0;f===!0&&(S=1),_===!0&&(S=2),v===!0&&(S=3);let M=a.attributes.position.count*S,R=1;M>e.maxTextureSize&&(R=Math.ceil(M/e.maxTextureSize),M=e.maxTextureSize);const A=new Float32Array(M*R*4*d),C=new Pu(A,M,R,d);C.type=Ai,C.needsUpdate=!0;const D=S*4;for(let b=0;b<d;b++){const E=g[b],F=m[b],O=y[b],X=M*R*4*b;for(let re=0;re<E.count;re++){const K=re*D;f===!0&&(r.fromBufferAttribute(E,re),A[X+K+0]=r.x,A[X+K+1]=r.y,A[X+K+2]=r.z,A[X+K+3]=0),_===!0&&(r.fromBufferAttribute(F,re),A[X+K+4]=r.x,A[X+K+5]=r.y,A[X+K+6]=r.z,A[X+K+7]=0),v===!0&&(r.fromBufferAttribute(O,re),A[X+K+8]=r.x,A[X+K+9]=r.y,A[X+K+10]=r.z,A[X+K+11]=O.itemSize===4?r.w:1)}}h={count:d,texture:C,size:new Xe(M,R)},i.set(a,h),a.addEventListener("dispose",$)}if(o.isInstancedMesh===!0&&o.morphTexture!==null)l.getUniforms().setValue(n,"morphTexture",o.morphTexture,t);else{let f=0;for(let v=0;v<c.length;v++)f+=c[v];const _=a.morphTargetsRelative?1:1-f;l.getUniforms().setValue(n,"morphTargetBaseInfluence",_),l.getUniforms().setValue(n,"morphTargetInfluences",c)}l.getUniforms().setValue(n,"morphTargetsTexture",h.texture,t),l.getUniforms().setValue(n,"morphTargetsTextureSize",h.size)}return{update:s}}function Ny(n,e,t,i){let r=new WeakMap;function s(l){const c=i.render.frame,u=l.geometry,d=e.get(l,u);if(r.get(d)!==c&&(e.update(d),r.set(d,c)),l.isInstancedMesh&&(l.hasEventListener("dispose",a)===!1&&l.addEventListener("dispose",a),r.get(l)!==c&&(t.update(l.instanceMatrix,n.ARRAY_BUFFER),l.instanceColor!==null&&t.update(l.instanceColor,n.ARRAY_BUFFER),r.set(l,c))),l.isSkinnedMesh){const h=l.skeleton;r.get(h)!==c&&(h.update(),r.set(h,c))}return d}function o(){r=new WeakMap}function a(l){const c=l.target;c.removeEventListener("dispose",a),t.remove(c.instanceMatrix),c.instanceColor!==null&&t.remove(c.instanceColor)}return{update:s,dispose:o}}class gp extends nn{constructor(e,t,i,r,s,o,a,l,c,u=_s){if(u!==_s&&u!==Ms)throw new Error("DepthTexture format must be either THREE.DepthFormat or THREE.DepthStencilFormat");i===void 0&&u===_s&&(i=Mr),i===void 0&&u===Ms&&(i=Ss),super(null,r,s,o,a,l,u,i,c),this.isDepthTexture=!0,this.image={width:e,height:t},this.magFilter=a!==void 0?a:Hn,this.minFilter=l!==void 0?l:Hn,this.flipY=!1,this.generateMipmaps=!1,this.compareFunction=null}copy(e){return super.copy(e),this.compareFunction=e.compareFunction,this}toJSON(e){const t=super.toJSON(e);return this.compareFunction!==null&&(t.compareFunction=this.compareFunction),t}}const _p=new nn,lh=new gp(1,1),vp=new Pu,yp=new x0,xp=new hp,ch=[],uh=[],dh=new Float32Array(16),hh=new Float32Array(9),fh=new Float32Array(4);function Ps(n,e,t){const i=n[0];if(i<=0||i>0)return n;const r=e*t;let s=ch[r];if(s===void 0&&(s=new Float32Array(r),ch[r]=s),e!==0){i.toArray(s,0);for(let o=1,a=0;o!==e;++o)a+=t,n[o].toArray(s,a)}return s}function Gt(n,e){if(n.length!==e.length)return!1;for(let t=0,i=n.length;t<i;t++)if(n[t]!==e[t])return!1;return!0}function Wt(n,e){for(let t=0,i=e.length;t<i;t++)n[t]=e[t]}function Xa(n,e){let t=uh[e];t===void 0&&(t=new Int32Array(e),uh[e]=t);for(let i=0;i!==e;++i)t[i]=n.allocateTextureUnit();return t}function Uy(n,e){const t=this.cache;t[0]!==e&&(n.uniform1f(this.addr,e),t[0]=e)}function Fy(n,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y)&&(n.uniform2f(this.addr,e.x,e.y),t[0]=e.x,t[1]=e.y);else{if(Gt(t,e))return;n.uniform2fv(this.addr,e),Wt(t,e)}}function Oy(n,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z)&&(n.uniform3f(this.addr,e.x,e.y,e.z),t[0]=e.x,t[1]=e.y,t[2]=e.z);else if(e.r!==void 0)(t[0]!==e.r||t[1]!==e.g||t[2]!==e.b)&&(n.uniform3f(this.addr,e.r,e.g,e.b),t[0]=e.r,t[1]=e.g,t[2]=e.b);else{if(Gt(t,e))return;n.uniform3fv(this.addr,e),Wt(t,e)}}function By(n,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z||t[3]!==e.w)&&(n.uniform4f(this.addr,e.x,e.y,e.z,e.w),t[0]=e.x,t[1]=e.y,t[2]=e.z,t[3]=e.w);else{if(Gt(t,e))return;n.uniform4fv(this.addr,e),Wt(t,e)}}function ky(n,e){const t=this.cache,i=e.elements;if(i===void 0){if(Gt(t,e))return;n.uniformMatrix2fv(this.addr,!1,e),Wt(t,e)}else{if(Gt(t,i))return;fh.set(i),n.uniformMatrix2fv(this.addr,!1,fh),Wt(t,i)}}function zy(n,e){const t=this.cache,i=e.elements;if(i===void 0){if(Gt(t,e))return;n.uniformMatrix3fv(this.addr,!1,e),Wt(t,e)}else{if(Gt(t,i))return;hh.set(i),n.uniformMatrix3fv(this.addr,!1,hh),Wt(t,i)}}function Hy(n,e){const t=this.cache,i=e.elements;if(i===void 0){if(Gt(t,e))return;n.uniformMatrix4fv(this.addr,!1,e),Wt(t,e)}else{if(Gt(t,i))return;dh.set(i),n.uniformMatrix4fv(this.addr,!1,dh),Wt(t,i)}}function Vy(n,e){const t=this.cache;t[0]!==e&&(n.uniform1i(this.addr,e),t[0]=e)}function Gy(n,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y)&&(n.uniform2i(this.addr,e.x,e.y),t[0]=e.x,t[1]=e.y);else{if(Gt(t,e))return;n.uniform2iv(this.addr,e),Wt(t,e)}}function Wy(n,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z)&&(n.uniform3i(this.addr,e.x,e.y,e.z),t[0]=e.x,t[1]=e.y,t[2]=e.z);else{if(Gt(t,e))return;n.uniform3iv(this.addr,e),Wt(t,e)}}function $y(n,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z||t[3]!==e.w)&&(n.uniform4i(this.addr,e.x,e.y,e.z,e.w),t[0]=e.x,t[1]=e.y,t[2]=e.z,t[3]=e.w);else{if(Gt(t,e))return;n.uniform4iv(this.addr,e),Wt(t,e)}}function Xy(n,e){const t=this.cache;t[0]!==e&&(n.uniform1ui(this.addr,e),t[0]=e)}function jy(n,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y)&&(n.uniform2ui(this.addr,e.x,e.y),t[0]=e.x,t[1]=e.y);else{if(Gt(t,e))return;n.uniform2uiv(this.addr,e),Wt(t,e)}}function qy(n,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z)&&(n.uniform3ui(this.addr,e.x,e.y,e.z),t[0]=e.x,t[1]=e.y,t[2]=e.z);else{if(Gt(t,e))return;n.uniform3uiv(this.addr,e),Wt(t,e)}}function Yy(n,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z||t[3]!==e.w)&&(n.uniform4ui(this.addr,e.x,e.y,e.z,e.w),t[0]=e.x,t[1]=e.y,t[2]=e.z,t[3]=e.w);else{if(Gt(t,e))return;n.uniform4uiv(this.addr,e),Wt(t,e)}}function Zy(n,e,t){const i=this.cache,r=t.allocateTextureUnit();i[0]!==r&&(n.uniform1i(this.addr,r),i[0]=r);let s;this.type===n.SAMPLER_2D_SHADOW?(lh.compareFunction=rp,s=lh):s=_p,t.setTexture2D(e||s,r)}function Ky(n,e,t){const i=this.cache,r=t.allocateTextureUnit();i[0]!==r&&(n.uniform1i(this.addr,r),i[0]=r),t.setTexture3D(e||yp,r)}function Jy(n,e,t){const i=this.cache,r=t.allocateTextureUnit();i[0]!==r&&(n.uniform1i(this.addr,r),i[0]=r),t.setTextureCube(e||xp,r)}function Qy(n,e,t){const i=this.cache,r=t.allocateTextureUnit();i[0]!==r&&(n.uniform1i(this.addr,r),i[0]=r),t.setTexture2DArray(e||vp,r)}function ex(n){switch(n){case 5126:return Uy;case 35664:return Fy;case 35665:return Oy;case 35666:return By;case 35674:return ky;case 35675:return zy;case 35676:return Hy;case 5124:case 35670:return Vy;case 35667:case 35671:return Gy;case 35668:case 35672:return Wy;case 35669:case 35673:return $y;case 5125:return Xy;case 36294:return jy;case 36295:return qy;case 36296:return Yy;case 35678:case 36198:case 36298:case 36306:case 35682:return Zy;case 35679:case 36299:case 36307:return Ky;case 35680:case 36300:case 36308:case 36293:return Jy;case 36289:case 36303:case 36311:case 36292:return Qy}}function tx(n,e){n.uniform1fv(this.addr,e)}function nx(n,e){const t=Ps(e,this.size,2);n.uniform2fv(this.addr,t)}function ix(n,e){const t=Ps(e,this.size,3);n.uniform3fv(this.addr,t)}function rx(n,e){const t=Ps(e,this.size,4);n.uniform4fv(this.addr,t)}function sx(n,e){const t=Ps(e,this.size,4);n.uniformMatrix2fv(this.addr,!1,t)}function ox(n,e){const t=Ps(e,this.size,9);n.uniformMatrix3fv(this.addr,!1,t)}function ax(n,e){const t=Ps(e,this.size,16);n.uniformMatrix4fv(this.addr,!1,t)}function lx(n,e){n.uniform1iv(this.addr,e)}function cx(n,e){n.uniform2iv(this.addr,e)}function ux(n,e){n.uniform3iv(this.addr,e)}function dx(n,e){n.uniform4iv(this.addr,e)}function hx(n,e){n.uniform1uiv(this.addr,e)}function fx(n,e){n.uniform2uiv(this.addr,e)}function px(n,e){n.uniform3uiv(this.addr,e)}function mx(n,e){n.uniform4uiv(this.addr,e)}function gx(n,e,t){const i=this.cache,r=e.length,s=Xa(t,r);Gt(i,s)||(n.uniform1iv(this.addr,s),Wt(i,s));for(let o=0;o!==r;++o)t.setTexture2D(e[o]||_p,s[o])}function _x(n,e,t){const i=this.cache,r=e.length,s=Xa(t,r);Gt(i,s)||(n.uniform1iv(this.addr,s),Wt(i,s));for(let o=0;o!==r;++o)t.setTexture3D(e[o]||yp,s[o])}function vx(n,e,t){const i=this.cache,r=e.length,s=Xa(t,r);Gt(i,s)||(n.uniform1iv(this.addr,s),Wt(i,s));for(let o=0;o!==r;++o)t.setTextureCube(e[o]||xp,s[o])}function yx(n,e,t){const i=this.cache,r=e.length,s=Xa(t,r);Gt(i,s)||(n.uniform1iv(this.addr,s),Wt(i,s));for(let o=0;o!==r;++o)t.setTexture2DArray(e[o]||vp,s[o])}function xx(n){switch(n){case 5126:return tx;case 35664:return nx;case 35665:return ix;case 35666:return rx;case 35674:return sx;case 35675:return ox;case 35676:return ax;case 5124:case 35670:return lx;case 35667:case 35671:return cx;case 35668:case 35672:return ux;case 35669:case 35673:return dx;case 5125:return hx;case 36294:return fx;case 36295:return px;case 36296:return mx;case 35678:case 36198:case 36298:case 36306:case 35682:return gx;case 35679:case 36299:case 36307:return _x;case 35680:case 36300:case 36308:case 36293:return vx;case 36289:case 36303:case 36311:case 36292:return yx}}class bx{constructor(e,t,i){this.id=e,this.addr=i,this.cache=[],this.type=t.type,this.setValue=ex(t.type)}}class Sx{constructor(e,t,i){this.id=e,this.addr=i,this.cache=[],this.type=t.type,this.size=t.size,this.setValue=xx(t.type)}}class Mx{constructor(e){this.id=e,this.seq=[],this.map={}}setValue(e,t,i){const r=this.seq;for(let s=0,o=r.length;s!==o;++s){const a=r[s];a.setValue(e,t[a.id],i)}}}const Vl=/(\w+)(\])?(\[|\.)?/g;function ph(n,e){n.seq.push(e),n.map[e.id]=e}function wx(n,e,t){const i=n.name,r=i.length;for(Vl.lastIndex=0;;){const s=Vl.exec(i),o=Vl.lastIndex;let a=s[1];const l=s[2]==="]",c=s[3];if(l&&(a=a|0),c===void 0||c==="["&&o+2===r){ph(t,c===void 0?new bx(a,n,e):new Sx(a,n,e));break}else{let d=t.map[a];d===void 0&&(d=new Mx(a),ph(t,d)),t=d}}}class Ra{constructor(e,t){this.seq=[],this.map={};const i=e.getProgramParameter(t,e.ACTIVE_UNIFORMS);for(let r=0;r<i;++r){const s=e.getActiveUniform(t,r),o=e.getUniformLocation(t,s.name);wx(s,o,this)}}setValue(e,t,i,r){const s=this.map[t];s!==void 0&&s.setValue(e,i,r)}setOptional(e,t,i){const r=t[i];r!==void 0&&this.setValue(e,i,r)}static upload(e,t,i,r){for(let s=0,o=t.length;s!==o;++s){const a=t[s],l=i[a.id];l.needsUpdate!==!1&&a.setValue(e,l.value,r)}}static seqWithValue(e,t){const i=[];for(let r=0,s=e.length;r!==s;++r){const o=e[r];o.id in t&&i.push(o)}return i}}function mh(n,e,t){const i=n.createShader(e);return n.shaderSource(i,t),n.compileShader(i),i}const Ex=37297;let Tx=0;function Ax(n,e){const t=n.split(`
`),i=[],r=Math.max(e-6,0),s=Math.min(e+6,t.length);for(let o=r;o<s;o++){const a=o+1;i.push(`${a===e?">":" "} ${a}: ${t[o]}`)}return i.join(`
`)}function Cx(n){const e=ft.getPrimaries(ft.workingColorSpace),t=ft.getPrimaries(n);let i;switch(e===t?i="":e===Ua&&t===Na?i="LinearDisplayP3ToLinearSRGB":e===Na&&t===Ua&&(i="LinearSRGBToLinearDisplayP3"),n){case rr:case Wa:return[i,"LinearTransferOETF"];case Ln:case Au:return[i,"sRGBTransferOETF"];default:return console.warn("THREE.WebGLProgram: Unsupported color space:",n),[i,"LinearTransferOETF"]}}function gh(n,e,t){const i=n.getShaderParameter(e,n.COMPILE_STATUS),r=n.getShaderInfoLog(e).trim();if(i&&r==="")return"";const s=/ERROR: 0:(\d+)/.exec(r);if(s){const o=parseInt(s[1]);return t.toUpperCase()+`

`+r+`

`+Ax(n.getShaderSource(e),o)}else return r}function Px(n,e){const t=Cx(e);return`vec4 ${n}( vec4 value ) { return ${t[0]}( ${t[1]}( value ) ); }`}function Rx(n,e){let t;switch(e){case Ig:t="Linear";break;case Dg:t="Reinhard";break;case Ng:t="Cineon";break;case $f:t="ACESFilmic";break;case Fg:t="AgX";break;case Og:t="Neutral";break;case Ug:t="Custom";break;default:console.warn("THREE.WebGLProgram: Unsupported toneMapping:",e),t="Linear"}return"vec3 "+n+"( vec3 color ) { return "+t+"ToneMapping( color ); }"}const Ko=new z;function Lx(){ft.getLuminanceCoefficients(Ko);const n=Ko.x.toFixed(4),e=Ko.y.toFixed(4),t=Ko.z.toFixed(4);return["float luminance( const in vec3 rgb ) {",`	const vec3 weights = vec3( ${n}, ${e}, ${t} );`,"	return dot( weights, rgb );","}"].join(`
`)}function Ix(n){return[n.extensionClipCullDistance?"#extension GL_ANGLE_clip_cull_distance : require":"",n.extensionMultiDraw?"#extension GL_ANGLE_multi_draw : require":""].filter(ro).join(`
`)}function Dx(n){const e=[];for(const t in n){const i=n[t];i!==!1&&e.push("#define "+t+" "+i)}return e.join(`
`)}function Nx(n,e){const t={},i=n.getProgramParameter(e,n.ACTIVE_ATTRIBUTES);for(let r=0;r<i;r++){const s=n.getActiveAttrib(e,r),o=s.name;let a=1;s.type===n.FLOAT_MAT2&&(a=2),s.type===n.FLOAT_MAT3&&(a=3),s.type===n.FLOAT_MAT4&&(a=4),t[o]={type:s.type,location:n.getAttribLocation(e,o),locationSize:a}}return t}function ro(n){return n!==""}function _h(n,e){const t=e.numSpotLightShadows+e.numSpotLightMaps-e.numSpotLightShadowsWithMaps;return n.replace(/NUM_DIR_LIGHTS/g,e.numDirLights).replace(/NUM_SPOT_LIGHTS/g,e.numSpotLights).replace(/NUM_SPOT_LIGHT_MAPS/g,e.numSpotLightMaps).replace(/NUM_SPOT_LIGHT_COORDS/g,t).replace(/NUM_RECT_AREA_LIGHTS/g,e.numRectAreaLights).replace(/NUM_POINT_LIGHTS/g,e.numPointLights).replace(/NUM_HEMI_LIGHTS/g,e.numHemiLights).replace(/NUM_DIR_LIGHT_SHADOWS/g,e.numDirLightShadows).replace(/NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS/g,e.numSpotLightShadowsWithMaps).replace(/NUM_SPOT_LIGHT_SHADOWS/g,e.numSpotLightShadows).replace(/NUM_POINT_LIGHT_SHADOWS/g,e.numPointLightShadows)}function vh(n,e){return n.replace(/NUM_CLIPPING_PLANES/g,e.numClippingPlanes).replace(/UNION_CLIPPING_PLANES/g,e.numClippingPlanes-e.numClipIntersection)}const Ux=/^[ \t]*#include +<([\w\d./]+)>/gm;function Jc(n){return n.replace(Ux,Ox)}const Fx=new Map;function Ox(n,e){let t=it[e];if(t===void 0){const i=Fx.get(e);if(i!==void 0)t=it[i],console.warn('THREE.WebGLRenderer: Shader chunk "%s" has been deprecated. Use "%s" instead.',e,i);else throw new Error("Can not resolve #include <"+e+">")}return Jc(t)}const Bx=/#pragma unroll_loop_start\s+for\s*\(\s*int\s+i\s*=\s*(\d+)\s*;\s*i\s*<\s*(\d+)\s*;\s*i\s*\+\+\s*\)\s*{([\s\S]+?)}\s+#pragma unroll_loop_end/g;function yh(n){return n.replace(Bx,kx)}function kx(n,e,t,i){let r="";for(let s=parseInt(e);s<parseInt(t);s++)r+=i.replace(/\[\s*i\s*\]/g,"[ "+s+" ]").replace(/UNROLLED_LOOP_INDEX/g,s);return r}function xh(n){let e=`precision ${n.precision} float;
	precision ${n.precision} int;
	precision ${n.precision} sampler2D;
	precision ${n.precision} samplerCube;
	precision ${n.precision} sampler3D;
	precision ${n.precision} sampler2DArray;
	precision ${n.precision} sampler2DShadow;
	precision ${n.precision} samplerCubeShadow;
	precision ${n.precision} sampler2DArrayShadow;
	precision ${n.precision} isampler2D;
	precision ${n.precision} isampler3D;
	precision ${n.precision} isamplerCube;
	precision ${n.precision} isampler2DArray;
	precision ${n.precision} usampler2D;
	precision ${n.precision} usampler3D;
	precision ${n.precision} usamplerCube;
	precision ${n.precision} usampler2DArray;
	`;return n.precision==="highp"?e+=`
#define HIGH_PRECISION`:n.precision==="mediump"?e+=`
#define MEDIUM_PRECISION`:n.precision==="lowp"&&(e+=`
#define LOW_PRECISION`),e}function zx(n){let e="SHADOWMAP_TYPE_BASIC";return n.shadowMapType===Gf?e="SHADOWMAP_TYPE_PCF":n.shadowMapType===dg?e="SHADOWMAP_TYPE_PCF_SOFT":n.shadowMapType===bi&&(e="SHADOWMAP_TYPE_VSM"),e}function Hx(n){let e="ENVMAP_TYPE_CUBE";if(n.envMap)switch(n.envMapMode){case xs:case bs:e="ENVMAP_TYPE_CUBE";break;case Ga:e="ENVMAP_TYPE_CUBE_UV";break}return e}function Vx(n){let e="ENVMAP_MODE_REFLECTION";if(n.envMap)switch(n.envMapMode){case bs:e="ENVMAP_MODE_REFRACTION";break}return e}function Gx(n){let e="ENVMAP_BLENDING_NONE";if(n.envMap)switch(n.combine){case Wf:e="ENVMAP_BLENDING_MULTIPLY";break;case Rg:e="ENVMAP_BLENDING_MIX";break;case Lg:e="ENVMAP_BLENDING_ADD";break}return e}function Wx(n){const e=n.envMapCubeUVHeight;if(e===null)return null;const t=Math.log2(e)-2,i=1/e;return{texelWidth:1/(3*Math.max(Math.pow(2,t),7*16)),texelHeight:i,maxMip:t}}function $x(n,e,t,i){const r=n.getContext(),s=t.defines;let o=t.vertexShader,a=t.fragmentShader;const l=zx(t),c=Hx(t),u=Vx(t),d=Gx(t),h=Wx(t),f=Ix(t),_=Dx(s),v=r.createProgram();let g,m,y=t.glslVersion?"#version "+t.glslVersion+`
`:"";t.isRawShaderMaterial?(g=["#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,_].filter(ro).join(`
`),g.length>0&&(g+=`
`),m=["#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,_].filter(ro).join(`
`),m.length>0&&(m+=`
`)):(g=[xh(t),"#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,_,t.extensionClipCullDistance?"#define USE_CLIP_DISTANCE":"",t.batching?"#define USE_BATCHING":"",t.batchingColor?"#define USE_BATCHING_COLOR":"",t.instancing?"#define USE_INSTANCING":"",t.instancingColor?"#define USE_INSTANCING_COLOR":"",t.instancingMorph?"#define USE_INSTANCING_MORPH":"",t.useFog&&t.fog?"#define USE_FOG":"",t.useFog&&t.fogExp2?"#define FOG_EXP2":"",t.map?"#define USE_MAP":"",t.envMap?"#define USE_ENVMAP":"",t.envMap?"#define "+u:"",t.lightMap?"#define USE_LIGHTMAP":"",t.aoMap?"#define USE_AOMAP":"",t.bumpMap?"#define USE_BUMPMAP":"",t.normalMap?"#define USE_NORMALMAP":"",t.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",t.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",t.displacementMap?"#define USE_DISPLACEMENTMAP":"",t.emissiveMap?"#define USE_EMISSIVEMAP":"",t.anisotropy?"#define USE_ANISOTROPY":"",t.anisotropyMap?"#define USE_ANISOTROPYMAP":"",t.clearcoatMap?"#define USE_CLEARCOATMAP":"",t.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",t.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",t.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",t.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",t.specularMap?"#define USE_SPECULARMAP":"",t.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",t.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",t.roughnessMap?"#define USE_ROUGHNESSMAP":"",t.metalnessMap?"#define USE_METALNESSMAP":"",t.alphaMap?"#define USE_ALPHAMAP":"",t.alphaHash?"#define USE_ALPHAHASH":"",t.transmission?"#define USE_TRANSMISSION":"",t.transmissionMap?"#define USE_TRANSMISSIONMAP":"",t.thicknessMap?"#define USE_THICKNESSMAP":"",t.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",t.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",t.mapUv?"#define MAP_UV "+t.mapUv:"",t.alphaMapUv?"#define ALPHAMAP_UV "+t.alphaMapUv:"",t.lightMapUv?"#define LIGHTMAP_UV "+t.lightMapUv:"",t.aoMapUv?"#define AOMAP_UV "+t.aoMapUv:"",t.emissiveMapUv?"#define EMISSIVEMAP_UV "+t.emissiveMapUv:"",t.bumpMapUv?"#define BUMPMAP_UV "+t.bumpMapUv:"",t.normalMapUv?"#define NORMALMAP_UV "+t.normalMapUv:"",t.displacementMapUv?"#define DISPLACEMENTMAP_UV "+t.displacementMapUv:"",t.metalnessMapUv?"#define METALNESSMAP_UV "+t.metalnessMapUv:"",t.roughnessMapUv?"#define ROUGHNESSMAP_UV "+t.roughnessMapUv:"",t.anisotropyMapUv?"#define ANISOTROPYMAP_UV "+t.anisotropyMapUv:"",t.clearcoatMapUv?"#define CLEARCOATMAP_UV "+t.clearcoatMapUv:"",t.clearcoatNormalMapUv?"#define CLEARCOAT_NORMALMAP_UV "+t.clearcoatNormalMapUv:"",t.clearcoatRoughnessMapUv?"#define CLEARCOAT_ROUGHNESSMAP_UV "+t.clearcoatRoughnessMapUv:"",t.iridescenceMapUv?"#define IRIDESCENCEMAP_UV "+t.iridescenceMapUv:"",t.iridescenceThicknessMapUv?"#define IRIDESCENCE_THICKNESSMAP_UV "+t.iridescenceThicknessMapUv:"",t.sheenColorMapUv?"#define SHEEN_COLORMAP_UV "+t.sheenColorMapUv:"",t.sheenRoughnessMapUv?"#define SHEEN_ROUGHNESSMAP_UV "+t.sheenRoughnessMapUv:"",t.specularMapUv?"#define SPECULARMAP_UV "+t.specularMapUv:"",t.specularColorMapUv?"#define SPECULAR_COLORMAP_UV "+t.specularColorMapUv:"",t.specularIntensityMapUv?"#define SPECULAR_INTENSITYMAP_UV "+t.specularIntensityMapUv:"",t.transmissionMapUv?"#define TRANSMISSIONMAP_UV "+t.transmissionMapUv:"",t.thicknessMapUv?"#define THICKNESSMAP_UV "+t.thicknessMapUv:"",t.vertexTangents&&t.flatShading===!1?"#define USE_TANGENT":"",t.vertexColors?"#define USE_COLOR":"",t.vertexAlphas?"#define USE_COLOR_ALPHA":"",t.vertexUv1s?"#define USE_UV1":"",t.vertexUv2s?"#define USE_UV2":"",t.vertexUv3s?"#define USE_UV3":"",t.pointsUvs?"#define USE_POINTS_UV":"",t.flatShading?"#define FLAT_SHADED":"",t.skinning?"#define USE_SKINNING":"",t.morphTargets?"#define USE_MORPHTARGETS":"",t.morphNormals&&t.flatShading===!1?"#define USE_MORPHNORMALS":"",t.morphColors?"#define USE_MORPHCOLORS":"",t.morphTargetsCount>0?"#define MORPHTARGETS_TEXTURE_STRIDE "+t.morphTextureStride:"",t.morphTargetsCount>0?"#define MORPHTARGETS_COUNT "+t.morphTargetsCount:"",t.doubleSided?"#define DOUBLE_SIDED":"",t.flipSided?"#define FLIP_SIDED":"",t.shadowMapEnabled?"#define USE_SHADOWMAP":"",t.shadowMapEnabled?"#define "+l:"",t.sizeAttenuation?"#define USE_SIZEATTENUATION":"",t.numLightProbes>0?"#define USE_LIGHT_PROBES":"",t.logarithmicDepthBuffer?"#define USE_LOGDEPTHBUF":"",t.reverseDepthBuffer?"#define USE_REVERSEDEPTHBUF":"","uniform mat4 modelMatrix;","uniform mat4 modelViewMatrix;","uniform mat4 projectionMatrix;","uniform mat4 viewMatrix;","uniform mat3 normalMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;","#ifdef USE_INSTANCING","	attribute mat4 instanceMatrix;","#endif","#ifdef USE_INSTANCING_COLOR","	attribute vec3 instanceColor;","#endif","#ifdef USE_INSTANCING_MORPH","	uniform sampler2D morphTexture;","#endif","attribute vec3 position;","attribute vec3 normal;","attribute vec2 uv;","#ifdef USE_UV1","	attribute vec2 uv1;","#endif","#ifdef USE_UV2","	attribute vec2 uv2;","#endif","#ifdef USE_UV3","	attribute vec2 uv3;","#endif","#ifdef USE_TANGENT","	attribute vec4 tangent;","#endif","#if defined( USE_COLOR_ALPHA )","	attribute vec4 color;","#elif defined( USE_COLOR )","	attribute vec3 color;","#endif","#ifdef USE_SKINNING","	attribute vec4 skinIndex;","	attribute vec4 skinWeight;","#endif",`
`].filter(ro).join(`
`),m=[xh(t),"#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,_,t.useFog&&t.fog?"#define USE_FOG":"",t.useFog&&t.fogExp2?"#define FOG_EXP2":"",t.alphaToCoverage?"#define ALPHA_TO_COVERAGE":"",t.map?"#define USE_MAP":"",t.matcap?"#define USE_MATCAP":"",t.envMap?"#define USE_ENVMAP":"",t.envMap?"#define "+c:"",t.envMap?"#define "+u:"",t.envMap?"#define "+d:"",h?"#define CUBEUV_TEXEL_WIDTH "+h.texelWidth:"",h?"#define CUBEUV_TEXEL_HEIGHT "+h.texelHeight:"",h?"#define CUBEUV_MAX_MIP "+h.maxMip+".0":"",t.lightMap?"#define USE_LIGHTMAP":"",t.aoMap?"#define USE_AOMAP":"",t.bumpMap?"#define USE_BUMPMAP":"",t.normalMap?"#define USE_NORMALMAP":"",t.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",t.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",t.emissiveMap?"#define USE_EMISSIVEMAP":"",t.anisotropy?"#define USE_ANISOTROPY":"",t.anisotropyMap?"#define USE_ANISOTROPYMAP":"",t.clearcoat?"#define USE_CLEARCOAT":"",t.clearcoatMap?"#define USE_CLEARCOATMAP":"",t.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",t.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",t.dispersion?"#define USE_DISPERSION":"",t.iridescence?"#define USE_IRIDESCENCE":"",t.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",t.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",t.specularMap?"#define USE_SPECULARMAP":"",t.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",t.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",t.roughnessMap?"#define USE_ROUGHNESSMAP":"",t.metalnessMap?"#define USE_METALNESSMAP":"",t.alphaMap?"#define USE_ALPHAMAP":"",t.alphaTest?"#define USE_ALPHATEST":"",t.alphaHash?"#define USE_ALPHAHASH":"",t.sheen?"#define USE_SHEEN":"",t.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",t.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",t.transmission?"#define USE_TRANSMISSION":"",t.transmissionMap?"#define USE_TRANSMISSIONMAP":"",t.thicknessMap?"#define USE_THICKNESSMAP":"",t.vertexTangents&&t.flatShading===!1?"#define USE_TANGENT":"",t.vertexColors||t.instancingColor||t.batchingColor?"#define USE_COLOR":"",t.vertexAlphas?"#define USE_COLOR_ALPHA":"",t.vertexUv1s?"#define USE_UV1":"",t.vertexUv2s?"#define USE_UV2":"",t.vertexUv3s?"#define USE_UV3":"",t.pointsUvs?"#define USE_POINTS_UV":"",t.gradientMap?"#define USE_GRADIENTMAP":"",t.flatShading?"#define FLAT_SHADED":"",t.doubleSided?"#define DOUBLE_SIDED":"",t.flipSided?"#define FLIP_SIDED":"",t.shadowMapEnabled?"#define USE_SHADOWMAP":"",t.shadowMapEnabled?"#define "+l:"",t.premultipliedAlpha?"#define PREMULTIPLIED_ALPHA":"",t.numLightProbes>0?"#define USE_LIGHT_PROBES":"",t.decodeVideoTexture?"#define DECODE_VIDEO_TEXTURE":"",t.logarithmicDepthBuffer?"#define USE_LOGDEPTHBUF":"",t.reverseDepthBuffer?"#define USE_REVERSEDEPTHBUF":"","uniform mat4 viewMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;",t.toneMapping!==tr?"#define TONE_MAPPING":"",t.toneMapping!==tr?it.tonemapping_pars_fragment:"",t.toneMapping!==tr?Rx("toneMapping",t.toneMapping):"",t.dithering?"#define DITHERING":"",t.opaque?"#define OPAQUE":"",it.colorspace_pars_fragment,Px("linearToOutputTexel",t.outputColorSpace),Lx(),t.useDepthPacking?"#define DEPTH_PACKING "+t.depthPacking:"",`
`].filter(ro).join(`
`)),o=Jc(o),o=_h(o,t),o=vh(o,t),a=Jc(a),a=_h(a,t),a=vh(a,t),o=yh(o),a=yh(a),t.isRawShaderMaterial!==!0&&(y=`#version 300 es
`,g=[f,"#define attribute in","#define varying out","#define texture2D texture"].join(`
`)+`
`+g,m=["#define varying in",t.glslVersion===Fd?"":"layout(location = 0) out highp vec4 pc_fragColor;",t.glslVersion===Fd?"":"#define gl_FragColor pc_fragColor","#define gl_FragDepthEXT gl_FragDepth","#define texture2D texture","#define textureCube texture","#define texture2DProj textureProj","#define texture2DLodEXT textureLod","#define texture2DProjLodEXT textureProjLod","#define textureCubeLodEXT textureLod","#define texture2DGradEXT textureGrad","#define texture2DProjGradEXT textureProjGrad","#define textureCubeGradEXT textureGrad"].join(`
`)+`
`+m);const S=y+g+o,M=y+m+a,R=mh(r,r.VERTEX_SHADER,S),A=mh(r,r.FRAGMENT_SHADER,M);r.attachShader(v,R),r.attachShader(v,A),t.index0AttributeName!==void 0?r.bindAttribLocation(v,0,t.index0AttributeName):t.morphTargets===!0&&r.bindAttribLocation(v,0,"position"),r.linkProgram(v);function C(E){if(n.debug.checkShaderErrors){const F=r.getProgramInfoLog(v).trim(),O=r.getShaderInfoLog(R).trim(),X=r.getShaderInfoLog(A).trim();let re=!0,K=!0;if(r.getProgramParameter(v,r.LINK_STATUS)===!1)if(re=!1,typeof n.debug.onShaderError=="function")n.debug.onShaderError(r,v,R,A);else{const he=gh(r,R,"vertex"),j=gh(r,A,"fragment");console.error("THREE.WebGLProgram: Shader Error "+r.getError()+" - VALIDATE_STATUS "+r.getProgramParameter(v,r.VALIDATE_STATUS)+`

Material Name: `+E.name+`
Material Type: `+E.type+`

Program Info Log: `+F+`
`+he+`
`+j)}else F!==""?console.warn("THREE.WebGLProgram: Program Info Log:",F):(O===""||X==="")&&(K=!1);K&&(E.diagnostics={runnable:re,programLog:F,vertexShader:{log:O,prefix:g},fragmentShader:{log:X,prefix:m}})}r.deleteShader(R),r.deleteShader(A),D=new Ra(r,v),$=Nx(r,v)}let D;this.getUniforms=function(){return D===void 0&&C(this),D};let $;this.getAttributes=function(){return $===void 0&&C(this),$};let b=t.rendererExtensionParallelShaderCompile===!1;return this.isReady=function(){return b===!1&&(b=r.getProgramParameter(v,Ex)),b},this.destroy=function(){i.releaseStatesOfProgram(this),r.deleteProgram(v),this.program=void 0},this.type=t.shaderType,this.name=t.shaderName,this.id=Tx++,this.cacheKey=e,this.usedTimes=1,this.program=v,this.vertexShader=R,this.fragmentShader=A,this}let Xx=0;class jx{constructor(){this.shaderCache=new Map,this.materialCache=new Map}update(e){const t=e.vertexShader,i=e.fragmentShader,r=this._getShaderStage(t),s=this._getShaderStage(i),o=this._getShaderCacheForMaterial(e);return o.has(r)===!1&&(o.add(r),r.usedTimes++),o.has(s)===!1&&(o.add(s),s.usedTimes++),this}remove(e){const t=this.materialCache.get(e);for(const i of t)i.usedTimes--,i.usedTimes===0&&this.shaderCache.delete(i.code);return this.materialCache.delete(e),this}getVertexShaderID(e){return this._getShaderStage(e.vertexShader).id}getFragmentShaderID(e){return this._getShaderStage(e.fragmentShader).id}dispose(){this.shaderCache.clear(),this.materialCache.clear()}_getShaderCacheForMaterial(e){const t=this.materialCache;let i=t.get(e);return i===void 0&&(i=new Set,t.set(e,i)),i}_getShaderStage(e){const t=this.shaderCache;let i=t.get(e);return i===void 0&&(i=new qx(e),t.set(e,i)),i}}class qx{constructor(e){this.id=Xx++,this.code=e,this.usedTimes=0}}function Yx(n,e,t,i,r,s,o){const a=new Ru,l=new jx,c=new Set,u=[],d=r.logarithmicDepthBuffer,h=r.reverseDepthBuffer,f=r.vertexTextures;let _=r.precision;const v={MeshDepthMaterial:"depth",MeshDistanceMaterial:"distanceRGBA",MeshNormalMaterial:"normal",MeshBasicMaterial:"basic",MeshLambertMaterial:"lambert",MeshPhongMaterial:"phong",MeshToonMaterial:"toon",MeshStandardMaterial:"physical",MeshPhysicalMaterial:"physical",MeshMatcapMaterial:"matcap",LineBasicMaterial:"basic",LineDashedMaterial:"dashed",PointsMaterial:"points",ShadowMaterial:"shadow",SpriteMaterial:"sprite"};function g(b){return c.add(b),b===0?"uv":`uv${b}`}function m(b,E,F,O,X){const re=O.fog,K=X.geometry,he=b.isMeshStandardMaterial?O.environment:null,j=(b.isMeshStandardMaterial?t:e).get(b.envMap||he),Ee=j&&j.mapping===Ga?j.image.height:null,_e=v[b.type];b.precision!==null&&(_=r.getMaxPrecision(b.precision),_!==b.precision&&console.warn("THREE.WebGLProgram.getParameters:",b.precision,"not supported, using",_,"instead."));const Se=K.morphAttributes.position||K.morphAttributes.normal||K.morphAttributes.color,Me=Se!==void 0?Se.length:0;let ze=0;K.morphAttributes.position!==void 0&&(ze=1),K.morphAttributes.normal!==void 0&&(ze=2),K.morphAttributes.color!==void 0&&(ze=3);let ue,me,we,ye;if(_e){const Ye=si[_e];ue=Ye.vertexShader,me=Ye.fragmentShader}else ue=b.vertexShader,me=b.fragmentShader,l.update(b),we=l.getVertexShaderID(b),ye=l.getFragmentShaderID(b);const Ve=n.getRenderTarget(),Ne=X.isInstancedMesh===!0,qe=X.isBatchedMesh===!0,Be=!!b.map,Ge=!!b.matcap,G=!!j,vt=!!b.aoMap,et=!!b.lightMap,Ze=!!b.bumpMap,We=!!b.normalMap,at=!!b.displacementMap,He=!!b.emissiveMap,U=!!b.metalnessMap,P=!!b.roughnessMap,ne=b.anisotropy>0,fe=b.clearcoat>0,ge=b.dispersion>0,de=b.iridescence>0,Fe=b.sheen>0,be=b.transmission>0,Ae=ne&&!!b.anisotropyMap,T=fe&&!!b.clearcoatMap,p=fe&&!!b.clearcoatNormalMap,H=fe&&!!b.clearcoatRoughnessMap,ee=de&&!!b.iridescenceMap,te=de&&!!b.iridescenceThicknessMap,q=Fe&&!!b.sheenColorMap,ce=Fe&&!!b.sheenRoughnessMap,w=!!b.specularMap,Y=!!b.specularColorMap,N=!!b.specularIntensityMap,B=be&&!!b.transmissionMap,k=be&&!!b.thicknessMap,W=!!b.gradientMap,J=!!b.alphaMap,ae=b.alphaTest>0,pe=!!b.alphaHash,xe=!!b.extensions;let Le=tr;b.toneMapped&&(Ve===null||Ve.isXRRenderTarget===!0)&&(Le=n.toneMapping);const Re={shaderID:_e,shaderType:b.type,shaderName:b.name,vertexShader:ue,fragmentShader:me,defines:b.defines,customVertexShaderID:we,customFragmentShaderID:ye,isRawShaderMaterial:b.isRawShaderMaterial===!0,glslVersion:b.glslVersion,precision:_,batching:qe,batchingColor:qe&&X._colorsTexture!==null,instancing:Ne,instancingColor:Ne&&X.instanceColor!==null,instancingMorph:Ne&&X.morphTexture!==null,supportsVertexTextures:f,outputColorSpace:Ve===null?n.outputColorSpace:Ve.isXRRenderTarget===!0?Ve.texture.colorSpace:rr,alphaToCoverage:!!b.alphaToCoverage,map:Be,matcap:Ge,envMap:G,envMapMode:G&&j.mapping,envMapCubeUVHeight:Ee,aoMap:vt,lightMap:et,bumpMap:Ze,normalMap:We,displacementMap:f&&at,emissiveMap:He,normalMapObjectSpace:We&&b.normalMapType===Hg,normalMapTangentSpace:We&&b.normalMapType===ip,metalnessMap:U,roughnessMap:P,anisotropy:ne,anisotropyMap:Ae,clearcoat:fe,clearcoatMap:T,clearcoatNormalMap:p,clearcoatRoughnessMap:H,dispersion:ge,iridescence:de,iridescenceMap:ee,iridescenceThicknessMap:te,sheen:Fe,sheenColorMap:q,sheenRoughnessMap:ce,specularMap:w,specularColorMap:Y,specularIntensityMap:N,transmission:be,transmissionMap:B,thicknessMap:k,gradientMap:W,opaque:b.transparent===!1&&b.blending===gs&&b.alphaToCoverage===!1,alphaMap:J,alphaTest:ae,alphaHash:pe,combine:b.combine,mapUv:Be&&g(b.map.channel),aoMapUv:vt&&g(b.aoMap.channel),lightMapUv:et&&g(b.lightMap.channel),bumpMapUv:Ze&&g(b.bumpMap.channel),normalMapUv:We&&g(b.normalMap.channel),displacementMapUv:at&&g(b.displacementMap.channel),emissiveMapUv:He&&g(b.emissiveMap.channel),metalnessMapUv:U&&g(b.metalnessMap.channel),roughnessMapUv:P&&g(b.roughnessMap.channel),anisotropyMapUv:Ae&&g(b.anisotropyMap.channel),clearcoatMapUv:T&&g(b.clearcoatMap.channel),clearcoatNormalMapUv:p&&g(b.clearcoatNormalMap.channel),clearcoatRoughnessMapUv:H&&g(b.clearcoatRoughnessMap.channel),iridescenceMapUv:ee&&g(b.iridescenceMap.channel),iridescenceThicknessMapUv:te&&g(b.iridescenceThicknessMap.channel),sheenColorMapUv:q&&g(b.sheenColorMap.channel),sheenRoughnessMapUv:ce&&g(b.sheenRoughnessMap.channel),specularMapUv:w&&g(b.specularMap.channel),specularColorMapUv:Y&&g(b.specularColorMap.channel),specularIntensityMapUv:N&&g(b.specularIntensityMap.channel),transmissionMapUv:B&&g(b.transmissionMap.channel),thicknessMapUv:k&&g(b.thicknessMap.channel),alphaMapUv:J&&g(b.alphaMap.channel),vertexTangents:!!K.attributes.tangent&&(We||ne),vertexColors:b.vertexColors,vertexAlphas:b.vertexColors===!0&&!!K.attributes.color&&K.attributes.color.itemSize===4,pointsUvs:X.isPoints===!0&&!!K.attributes.uv&&(Be||J),fog:!!re,useFog:b.fog===!0,fogExp2:!!re&&re.isFogExp2,flatShading:b.flatShading===!0,sizeAttenuation:b.sizeAttenuation===!0,logarithmicDepthBuffer:d,reverseDepthBuffer:h,skinning:X.isSkinnedMesh===!0,morphTargets:K.morphAttributes.position!==void 0,morphNormals:K.morphAttributes.normal!==void 0,morphColors:K.morphAttributes.color!==void 0,morphTargetsCount:Me,morphTextureStride:ze,numDirLights:E.directional.length,numPointLights:E.point.length,numSpotLights:E.spot.length,numSpotLightMaps:E.spotLightMap.length,numRectAreaLights:E.rectArea.length,numHemiLights:E.hemi.length,numDirLightShadows:E.directionalShadowMap.length,numPointLightShadows:E.pointShadowMap.length,numSpotLightShadows:E.spotShadowMap.length,numSpotLightShadowsWithMaps:E.numSpotLightShadowsWithMaps,numLightProbes:E.numLightProbes,numClippingPlanes:o.numPlanes,numClipIntersection:o.numIntersection,dithering:b.dithering,shadowMapEnabled:n.shadowMap.enabled&&F.length>0,shadowMapType:n.shadowMap.type,toneMapping:Le,decodeVideoTexture:Be&&b.map.isVideoTexture===!0&&ft.getTransfer(b.map.colorSpace)===bt,premultipliedAlpha:b.premultipliedAlpha,doubleSided:b.side===en,flipSided:b.side===un,useDepthPacking:b.depthPacking>=0,depthPacking:b.depthPacking||0,index0AttributeName:b.index0AttributeName,extensionClipCullDistance:xe&&b.extensions.clipCullDistance===!0&&i.has("WEBGL_clip_cull_distance"),extensionMultiDraw:(xe&&b.extensions.multiDraw===!0||qe)&&i.has("WEBGL_multi_draw"),rendererExtensionParallelShaderCompile:i.has("KHR_parallel_shader_compile"),customProgramCacheKey:b.customProgramCacheKey()};return Re.vertexUv1s=c.has(1),Re.vertexUv2s=c.has(2),Re.vertexUv3s=c.has(3),c.clear(),Re}function y(b){const E=[];if(b.shaderID?E.push(b.shaderID):(E.push(b.customVertexShaderID),E.push(b.customFragmentShaderID)),b.defines!==void 0)for(const F in b.defines)E.push(F),E.push(b.defines[F]);return b.isRawShaderMaterial===!1&&(S(E,b),M(E,b),E.push(n.outputColorSpace)),E.push(b.customProgramCacheKey),E.join()}function S(b,E){b.push(E.precision),b.push(E.outputColorSpace),b.push(E.envMapMode),b.push(E.envMapCubeUVHeight),b.push(E.mapUv),b.push(E.alphaMapUv),b.push(E.lightMapUv),b.push(E.aoMapUv),b.push(E.bumpMapUv),b.push(E.normalMapUv),b.push(E.displacementMapUv),b.push(E.emissiveMapUv),b.push(E.metalnessMapUv),b.push(E.roughnessMapUv),b.push(E.anisotropyMapUv),b.push(E.clearcoatMapUv),b.push(E.clearcoatNormalMapUv),b.push(E.clearcoatRoughnessMapUv),b.push(E.iridescenceMapUv),b.push(E.iridescenceThicknessMapUv),b.push(E.sheenColorMapUv),b.push(E.sheenRoughnessMapUv),b.push(E.specularMapUv),b.push(E.specularColorMapUv),b.push(E.specularIntensityMapUv),b.push(E.transmissionMapUv),b.push(E.thicknessMapUv),b.push(E.combine),b.push(E.fogExp2),b.push(E.sizeAttenuation),b.push(E.morphTargetsCount),b.push(E.morphAttributeCount),b.push(E.numDirLights),b.push(E.numPointLights),b.push(E.numSpotLights),b.push(E.numSpotLightMaps),b.push(E.numHemiLights),b.push(E.numRectAreaLights),b.push(E.numDirLightShadows),b.push(E.numPointLightShadows),b.push(E.numSpotLightShadows),b.push(E.numSpotLightShadowsWithMaps),b.push(E.numLightProbes),b.push(E.shadowMapType),b.push(E.toneMapping),b.push(E.numClippingPlanes),b.push(E.numClipIntersection),b.push(E.depthPacking)}function M(b,E){a.disableAll(),E.supportsVertexTextures&&a.enable(0),E.instancing&&a.enable(1),E.instancingColor&&a.enable(2),E.instancingMorph&&a.enable(3),E.matcap&&a.enable(4),E.envMap&&a.enable(5),E.normalMapObjectSpace&&a.enable(6),E.normalMapTangentSpace&&a.enable(7),E.clearcoat&&a.enable(8),E.iridescence&&a.enable(9),E.alphaTest&&a.enable(10),E.vertexColors&&a.enable(11),E.vertexAlphas&&a.enable(12),E.vertexUv1s&&a.enable(13),E.vertexUv2s&&a.enable(14),E.vertexUv3s&&a.enable(15),E.vertexTangents&&a.enable(16),E.anisotropy&&a.enable(17),E.alphaHash&&a.enable(18),E.batching&&a.enable(19),E.dispersion&&a.enable(20),E.batchingColor&&a.enable(21),b.push(a.mask),a.disableAll(),E.fog&&a.enable(0),E.useFog&&a.enable(1),E.flatShading&&a.enable(2),E.logarithmicDepthBuffer&&a.enable(3),E.reverseDepthBuffer&&a.enable(4),E.skinning&&a.enable(5),E.morphTargets&&a.enable(6),E.morphNormals&&a.enable(7),E.morphColors&&a.enable(8),E.premultipliedAlpha&&a.enable(9),E.shadowMapEnabled&&a.enable(10),E.doubleSided&&a.enable(11),E.flipSided&&a.enable(12),E.useDepthPacking&&a.enable(13),E.dithering&&a.enable(14),E.transmission&&a.enable(15),E.sheen&&a.enable(16),E.opaque&&a.enable(17),E.pointsUvs&&a.enable(18),E.decodeVideoTexture&&a.enable(19),E.alphaToCoverage&&a.enable(20),b.push(a.mask)}function R(b){const E=v[b.type];let F;if(E){const O=si[E];F=I0.clone(O.uniforms)}else F=b.uniforms;return F}function A(b,E){let F;for(let O=0,X=u.length;O<X;O++){const re=u[O];if(re.cacheKey===E){F=re,++F.usedTimes;break}}return F===void 0&&(F=new $x(n,E,b,s),u.push(F)),F}function C(b){if(--b.usedTimes===0){const E=u.indexOf(b);u[E]=u[u.length-1],u.pop(),b.destroy()}}function D(b){l.remove(b)}function $(){l.dispose()}return{getParameters:m,getProgramCacheKey:y,getUniforms:R,acquireProgram:A,releaseProgram:C,releaseShaderCache:D,programs:u,dispose:$}}function Zx(){let n=new WeakMap;function e(o){return n.has(o)}function t(o){let a=n.get(o);return a===void 0&&(a={},n.set(o,a)),a}function i(o){n.delete(o)}function r(o,a,l){n.get(o)[a]=l}function s(){n=new WeakMap}return{has:e,get:t,remove:i,update:r,dispose:s}}function Kx(n,e){return n.groupOrder!==e.groupOrder?n.groupOrder-e.groupOrder:n.renderOrder!==e.renderOrder?n.renderOrder-e.renderOrder:n.material.id!==e.material.id?n.material.id-e.material.id:n.z!==e.z?n.z-e.z:n.id-e.id}function bh(n,e){return n.groupOrder!==e.groupOrder?n.groupOrder-e.groupOrder:n.renderOrder!==e.renderOrder?n.renderOrder-e.renderOrder:n.z!==e.z?e.z-n.z:n.id-e.id}function Sh(){const n=[];let e=0;const t=[],i=[],r=[];function s(){e=0,t.length=0,i.length=0,r.length=0}function o(d,h,f,_,v,g){let m=n[e];return m===void 0?(m={id:d.id,object:d,geometry:h,material:f,groupOrder:_,renderOrder:d.renderOrder,z:v,group:g},n[e]=m):(m.id=d.id,m.object=d,m.geometry=h,m.material=f,m.groupOrder=_,m.renderOrder=d.renderOrder,m.z=v,m.group=g),e++,m}function a(d,h,f,_,v,g){const m=o(d,h,f,_,v,g);f.transmission>0?i.push(m):f.transparent===!0?r.push(m):t.push(m)}function l(d,h,f,_,v,g){const m=o(d,h,f,_,v,g);f.transmission>0?i.unshift(m):f.transparent===!0?r.unshift(m):t.unshift(m)}function c(d,h){t.length>1&&t.sort(d||Kx),i.length>1&&i.sort(h||bh),r.length>1&&r.sort(h||bh)}function u(){for(let d=e,h=n.length;d<h;d++){const f=n[d];if(f.id===null)break;f.id=null,f.object=null,f.geometry=null,f.material=null,f.group=null}}return{opaque:t,transmissive:i,transparent:r,init:s,push:a,unshift:l,finish:u,sort:c}}function Jx(){let n=new WeakMap;function e(i,r){const s=n.get(i);let o;return s===void 0?(o=new Sh,n.set(i,[o])):r>=s.length?(o=new Sh,s.push(o)):o=s[r],o}function t(){n=new WeakMap}return{get:e,dispose:t}}function Qx(){const n={};return{get:function(e){if(n[e.id]!==void 0)return n[e.id];let t;switch(e.type){case"DirectionalLight":t={direction:new z,color:new Ke};break;case"SpotLight":t={position:new z,direction:new z,color:new Ke,distance:0,coneCos:0,penumbraCos:0,decay:0};break;case"PointLight":t={position:new z,color:new Ke,distance:0,decay:0};break;case"HemisphereLight":t={direction:new z,skyColor:new Ke,groundColor:new Ke};break;case"RectAreaLight":t={color:new Ke,position:new z,halfWidth:new z,halfHeight:new z};break}return n[e.id]=t,t}}}function eb(){const n={};return{get:function(e){if(n[e.id]!==void 0)return n[e.id];let t;switch(e.type){case"DirectionalLight":t={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Xe};break;case"SpotLight":t={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Xe};break;case"PointLight":t={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Xe,shadowCameraNear:1,shadowCameraFar:1e3};break}return n[e.id]=t,t}}}let tb=0;function nb(n,e){return(e.castShadow?2:0)-(n.castShadow?2:0)+(e.map?1:0)-(n.map?1:0)}function ib(n){const e=new Qx,t=eb(),i={version:0,hash:{directionalLength:-1,pointLength:-1,spotLength:-1,rectAreaLength:-1,hemiLength:-1,numDirectionalShadows:-1,numPointShadows:-1,numSpotShadows:-1,numSpotMaps:-1,numLightProbes:-1},ambient:[0,0,0],probe:[],directional:[],directionalShadow:[],directionalShadowMap:[],directionalShadowMatrix:[],spot:[],spotLightMap:[],spotShadow:[],spotShadowMap:[],spotLightMatrix:[],rectArea:[],rectAreaLTC1:null,rectAreaLTC2:null,point:[],pointShadow:[],pointShadowMap:[],pointShadowMatrix:[],hemi:[],numSpotLightShadowsWithMaps:0,numLightProbes:0};for(let c=0;c<9;c++)i.probe.push(new z);const r=new z,s=new ht,o=new ht;function a(c){let u=0,d=0,h=0;for(let $=0;$<9;$++)i.probe[$].set(0,0,0);let f=0,_=0,v=0,g=0,m=0,y=0,S=0,M=0,R=0,A=0,C=0;c.sort(nb);for(let $=0,b=c.length;$<b;$++){const E=c[$],F=E.color,O=E.intensity,X=E.distance,re=E.shadow&&E.shadow.map?E.shadow.map.texture:null;if(E.isAmbientLight)u+=F.r*O,d+=F.g*O,h+=F.b*O;else if(E.isLightProbe){for(let K=0;K<9;K++)i.probe[K].addScaledVector(E.sh.coefficients[K],O);C++}else if(E.isDirectionalLight){const K=e.get(E);if(K.color.copy(E.color).multiplyScalar(E.intensity),E.castShadow){const he=E.shadow,j=t.get(E);j.shadowIntensity=he.intensity,j.shadowBias=he.bias,j.shadowNormalBias=he.normalBias,j.shadowRadius=he.radius,j.shadowMapSize=he.mapSize,i.directionalShadow[f]=j,i.directionalShadowMap[f]=re,i.directionalShadowMatrix[f]=E.shadow.matrix,y++}i.directional[f]=K,f++}else if(E.isSpotLight){const K=e.get(E);K.position.setFromMatrixPosition(E.matrixWorld),K.color.copy(F).multiplyScalar(O),K.distance=X,K.coneCos=Math.cos(E.angle),K.penumbraCos=Math.cos(E.angle*(1-E.penumbra)),K.decay=E.decay,i.spot[v]=K;const he=E.shadow;if(E.map&&(i.spotLightMap[R]=E.map,R++,he.updateMatrices(E),E.castShadow&&A++),i.spotLightMatrix[v]=he.matrix,E.castShadow){const j=t.get(E);j.shadowIntensity=he.intensity,j.shadowBias=he.bias,j.shadowNormalBias=he.normalBias,j.shadowRadius=he.radius,j.shadowMapSize=he.mapSize,i.spotShadow[v]=j,i.spotShadowMap[v]=re,M++}v++}else if(E.isRectAreaLight){const K=e.get(E);K.color.copy(F).multiplyScalar(O),K.halfWidth.set(E.width*.5,0,0),K.halfHeight.set(0,E.height*.5,0),i.rectArea[g]=K,g++}else if(E.isPointLight){const K=e.get(E);if(K.color.copy(E.color).multiplyScalar(E.intensity),K.distance=E.distance,K.decay=E.decay,E.castShadow){const he=E.shadow,j=t.get(E);j.shadowIntensity=he.intensity,j.shadowBias=he.bias,j.shadowNormalBias=he.normalBias,j.shadowRadius=he.radius,j.shadowMapSize=he.mapSize,j.shadowCameraNear=he.camera.near,j.shadowCameraFar=he.camera.far,i.pointShadow[_]=j,i.pointShadowMap[_]=re,i.pointShadowMatrix[_]=E.shadow.matrix,S++}i.point[_]=K,_++}else if(E.isHemisphereLight){const K=e.get(E);K.skyColor.copy(E.color).multiplyScalar(O),K.groundColor.copy(E.groundColor).multiplyScalar(O),i.hemi[m]=K,m++}}g>0&&(n.has("OES_texture_float_linear")===!0?(i.rectAreaLTC1=Ce.LTC_FLOAT_1,i.rectAreaLTC2=Ce.LTC_FLOAT_2):(i.rectAreaLTC1=Ce.LTC_HALF_1,i.rectAreaLTC2=Ce.LTC_HALF_2)),i.ambient[0]=u,i.ambient[1]=d,i.ambient[2]=h;const D=i.hash;(D.directionalLength!==f||D.pointLength!==_||D.spotLength!==v||D.rectAreaLength!==g||D.hemiLength!==m||D.numDirectionalShadows!==y||D.numPointShadows!==S||D.numSpotShadows!==M||D.numSpotMaps!==R||D.numLightProbes!==C)&&(i.directional.length=f,i.spot.length=v,i.rectArea.length=g,i.point.length=_,i.hemi.length=m,i.directionalShadow.length=y,i.directionalShadowMap.length=y,i.pointShadow.length=S,i.pointShadowMap.length=S,i.spotShadow.length=M,i.spotShadowMap.length=M,i.directionalShadowMatrix.length=y,i.pointShadowMatrix.length=S,i.spotLightMatrix.length=M+R-A,i.spotLightMap.length=R,i.numSpotLightShadowsWithMaps=A,i.numLightProbes=C,D.directionalLength=f,D.pointLength=_,D.spotLength=v,D.rectAreaLength=g,D.hemiLength=m,D.numDirectionalShadows=y,D.numPointShadows=S,D.numSpotShadows=M,D.numSpotMaps=R,D.numLightProbes=C,i.version=tb++)}function l(c,u){let d=0,h=0,f=0,_=0,v=0;const g=u.matrixWorldInverse;for(let m=0,y=c.length;m<y;m++){const S=c[m];if(S.isDirectionalLight){const M=i.directional[d];M.direction.setFromMatrixPosition(S.matrixWorld),r.setFromMatrixPosition(S.target.matrixWorld),M.direction.sub(r),M.direction.transformDirection(g),d++}else if(S.isSpotLight){const M=i.spot[f];M.position.setFromMatrixPosition(S.matrixWorld),M.position.applyMatrix4(g),M.direction.setFromMatrixPosition(S.matrixWorld),r.setFromMatrixPosition(S.target.matrixWorld),M.direction.sub(r),M.direction.transformDirection(g),f++}else if(S.isRectAreaLight){const M=i.rectArea[_];M.position.setFromMatrixPosition(S.matrixWorld),M.position.applyMatrix4(g),o.identity(),s.copy(S.matrixWorld),s.premultiply(g),o.extractRotation(s),M.halfWidth.set(S.width*.5,0,0),M.halfHeight.set(0,S.height*.5,0),M.halfWidth.applyMatrix4(o),M.halfHeight.applyMatrix4(o),_++}else if(S.isPointLight){const M=i.point[h];M.position.setFromMatrixPosition(S.matrixWorld),M.position.applyMatrix4(g),h++}else if(S.isHemisphereLight){const M=i.hemi[v];M.direction.setFromMatrixPosition(S.matrixWorld),M.direction.transformDirection(g),v++}}}return{setup:a,setupView:l,state:i}}function Mh(n){const e=new ib(n),t=[],i=[];function r(u){c.camera=u,t.length=0,i.length=0}function s(u){t.push(u)}function o(u){i.push(u)}function a(){e.setup(t)}function l(u){e.setupView(t,u)}const c={lightsArray:t,shadowsArray:i,camera:null,lights:e,transmissionRenderTarget:{}};return{init:r,state:c,setupLights:a,setupLightsView:l,pushLight:s,pushShadow:o}}function rb(n){let e=new WeakMap;function t(r,s=0){const o=e.get(r);let a;return o===void 0?(a=new Mh(n),e.set(r,[a])):s>=o.length?(a=new Mh(n),o.push(a)):a=o[s],a}function i(){e=new WeakMap}return{get:t,dispose:i}}class sb extends Tr{constructor(e){super(),this.isMeshDepthMaterial=!0,this.type="MeshDepthMaterial",this.depthPacking=kg,this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.wireframe=!1,this.wireframeLinewidth=1,this.setValues(e)}copy(e){return super.copy(e),this.depthPacking=e.depthPacking,this.map=e.map,this.alphaMap=e.alphaMap,this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this}}class ob extends Tr{constructor(e){super(),this.isMeshDistanceMaterial=!0,this.type="MeshDistanceMaterial",this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.setValues(e)}copy(e){return super.copy(e),this.map=e.map,this.alphaMap=e.alphaMap,this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this}}const ab=`void main() {
	gl_Position = vec4( position, 1.0 );
}`,lb=`uniform sampler2D shadow_pass;
uniform vec2 resolution;
uniform float radius;
#include <packing>
void main() {
	const float samples = float( VSM_SAMPLES );
	float mean = 0.0;
	float squared_mean = 0.0;
	float uvStride = samples <= 1.0 ? 0.0 : 2.0 / ( samples - 1.0 );
	float uvStart = samples <= 1.0 ? 0.0 : - 1.0;
	for ( float i = 0.0; i < samples; i ++ ) {
		float uvOffset = uvStart + i * uvStride;
		#ifdef HORIZONTAL_PASS
			vec2 distribution = unpackRGBATo2Half( texture2D( shadow_pass, ( gl_FragCoord.xy + vec2( uvOffset, 0.0 ) * radius ) / resolution ) );
			mean += distribution.x;
			squared_mean += distribution.y * distribution.y + distribution.x * distribution.x;
		#else
			float depth = unpackRGBAToDepth( texture2D( shadow_pass, ( gl_FragCoord.xy + vec2( 0.0, uvOffset ) * radius ) / resolution ) );
			mean += depth;
			squared_mean += depth * depth;
		#endif
	}
	mean = mean / samples;
	squared_mean = squared_mean / samples;
	float std_dev = sqrt( squared_mean - mean * mean );
	gl_FragColor = pack2HalfToRGBA( vec2( mean, std_dev ) );
}`;function cb(n,e,t){let i=new fp;const r=new Xe,s=new Xe,o=new Rt,a=new sb({depthPacking:zg}),l=new ob,c={},u=t.maxTextureSize,d={[In]:un,[un]:In,[en]:en},h=new Dn({defines:{VSM_SAMPLES:8},uniforms:{shadow_pass:{value:null},resolution:{value:new Xe},radius:{value:4}},vertexShader:ab,fragmentShader:lb}),f=h.clone();f.defines.HORIZONTAL_PASS=1;const _=new Ct;_.setAttribute("position",new pt(new Float32Array([-1,-1,.5,3,-1,.5,-1,3,.5]),3));const v=new gn(_,h),g=this;this.enabled=!1,this.autoUpdate=!0,this.needsUpdate=!1,this.type=Gf;let m=this.type;this.render=function(A,C,D){if(g.enabled===!1||g.autoUpdate===!1&&g.needsUpdate===!1||A.length===0)return;const $=n.getRenderTarget(),b=n.getActiveCubeFace(),E=n.getActiveMipmapLevel(),F=n.state;F.setBlending(er),F.buffers.color.setClear(1,1,1,1),F.buffers.depth.setTest(!0),F.setScissorTest(!1);const O=m!==bi&&this.type===bi,X=m===bi&&this.type!==bi;for(let re=0,K=A.length;re<K;re++){const he=A[re],j=he.shadow;if(j===void 0){console.warn("THREE.WebGLShadowMap:",he,"has no shadow.");continue}if(j.autoUpdate===!1&&j.needsUpdate===!1)continue;r.copy(j.mapSize);const Ee=j.getFrameExtents();if(r.multiply(Ee),s.copy(j.mapSize),(r.x>u||r.y>u)&&(r.x>u&&(s.x=Math.floor(u/Ee.x),r.x=s.x*Ee.x,j.mapSize.x=s.x),r.y>u&&(s.y=Math.floor(u/Ee.y),r.y=s.y*Ee.y,j.mapSize.y=s.y)),j.map===null||O===!0||X===!0){const Se=this.type!==bi?{minFilter:Hn,magFilter:Hn}:{};j.map!==null&&j.map.dispose(),j.map=new nr(r.x,r.y,Se),j.map.texture.name=he.name+".shadowMap",j.camera.updateProjectionMatrix()}n.setRenderTarget(j.map),n.clear();const _e=j.getViewportCount();for(let Se=0;Se<_e;Se++){const Me=j.getViewport(Se);o.set(s.x*Me.x,s.y*Me.y,s.x*Me.z,s.y*Me.w),F.viewport(o),j.updateMatrices(he,Se),i=j.getFrustum(),M(C,D,j.camera,he,this.type)}j.isPointLightShadow!==!0&&this.type===bi&&y(j,D),j.needsUpdate=!1}m=this.type,g.needsUpdate=!1,n.setRenderTarget($,b,E)};function y(A,C){const D=e.update(v);h.defines.VSM_SAMPLES!==A.blurSamples&&(h.defines.VSM_SAMPLES=A.blurSamples,f.defines.VSM_SAMPLES=A.blurSamples,h.needsUpdate=!0,f.needsUpdate=!0),A.mapPass===null&&(A.mapPass=new nr(r.x,r.y)),h.uniforms.shadow_pass.value=A.map.texture,h.uniforms.resolution.value=A.mapSize,h.uniforms.radius.value=A.radius,n.setRenderTarget(A.mapPass),n.clear(),n.renderBufferDirect(C,null,D,h,v,null),f.uniforms.shadow_pass.value=A.mapPass.texture,f.uniforms.resolution.value=A.mapSize,f.uniforms.radius.value=A.radius,n.setRenderTarget(A.map),n.clear(),n.renderBufferDirect(C,null,D,f,v,null)}function S(A,C,D,$){let b=null;const E=D.isPointLight===!0?A.customDistanceMaterial:A.customDepthMaterial;if(E!==void 0)b=E;else if(b=D.isPointLight===!0?l:a,n.localClippingEnabled&&C.clipShadows===!0&&Array.isArray(C.clippingPlanes)&&C.clippingPlanes.length!==0||C.displacementMap&&C.displacementScale!==0||C.alphaMap&&C.alphaTest>0||C.map&&C.alphaTest>0){const F=b.uuid,O=C.uuid;let X=c[F];X===void 0&&(X={},c[F]=X);let re=X[O];re===void 0&&(re=b.clone(),X[O]=re,C.addEventListener("dispose",R)),b=re}if(b.visible=C.visible,b.wireframe=C.wireframe,$===bi?b.side=C.shadowSide!==null?C.shadowSide:C.side:b.side=C.shadowSide!==null?C.shadowSide:d[C.side],b.alphaMap=C.alphaMap,b.alphaTest=C.alphaTest,b.map=C.map,b.clipShadows=C.clipShadows,b.clippingPlanes=C.clippingPlanes,b.clipIntersection=C.clipIntersection,b.displacementMap=C.displacementMap,b.displacementScale=C.displacementScale,b.displacementBias=C.displacementBias,b.wireframeLinewidth=C.wireframeLinewidth,b.linewidth=C.linewidth,D.isPointLight===!0&&b.isMeshDistanceMaterial===!0){const F=n.properties.get(b);F.light=D}return b}function M(A,C,D,$,b){if(A.visible===!1)return;if(A.layers.test(C.layers)&&(A.isMesh||A.isLine||A.isPoints)&&(A.castShadow||A.receiveShadow&&b===bi)&&(!A.frustumCulled||i.intersectsObject(A))){A.modelViewMatrix.multiplyMatrices(D.matrixWorldInverse,A.matrixWorld);const O=e.update(A),X=A.material;if(Array.isArray(X)){const re=O.groups;for(let K=0,he=re.length;K<he;K++){const j=re[K],Ee=X[j.materialIndex];if(Ee&&Ee.visible){const _e=S(A,Ee,$,b);A.onBeforeShadow(n,A,C,D,O,_e,j),n.renderBufferDirect(D,null,O,_e,A,j),A.onAfterShadow(n,A,C,D,O,_e,j)}}}else if(X.visible){const re=S(A,X,$,b);A.onBeforeShadow(n,A,C,D,O,re,null),n.renderBufferDirect(D,null,O,re,A,null),A.onAfterShadow(n,A,C,D,O,re,null)}}const F=A.children;for(let O=0,X=F.length;O<X;O++)M(F[O],C,D,$,b)}function R(A){A.target.removeEventListener("dispose",R);for(const D in c){const $=c[D],b=A.target.uuid;b in $&&($[b].dispose(),delete $[b])}}}const ub={[gc]:_c,[vc]:bc,[yc]:Sc,[ys]:xc,[_c]:gc,[bc]:vc,[Sc]:yc,[xc]:ys};function db(n){function e(){let N=!1;const B=new Rt;let k=null;const W=new Rt(0,0,0,0);return{setMask:function(J){k!==J&&!N&&(n.colorMask(J,J,J,J),k=J)},setLocked:function(J){N=J},setClear:function(J,ae,pe,xe,Le){Le===!0&&(J*=xe,ae*=xe,pe*=xe),B.set(J,ae,pe,xe),W.equals(B)===!1&&(n.clearColor(J,ae,pe,xe),W.copy(B))},reset:function(){N=!1,k=null,W.set(-1,0,0,0)}}}function t(){let N=!1,B=!1,k=null,W=null,J=null;return{setReversed:function(ae){B=ae},setTest:function(ae){ae?we(n.DEPTH_TEST):ye(n.DEPTH_TEST)},setMask:function(ae){k!==ae&&!N&&(n.depthMask(ae),k=ae)},setFunc:function(ae){if(B&&(ae=ub[ae]),W!==ae){switch(ae){case gc:n.depthFunc(n.NEVER);break;case _c:n.depthFunc(n.ALWAYS);break;case vc:n.depthFunc(n.LESS);break;case ys:n.depthFunc(n.LEQUAL);break;case yc:n.depthFunc(n.EQUAL);break;case xc:n.depthFunc(n.GEQUAL);break;case bc:n.depthFunc(n.GREATER);break;case Sc:n.depthFunc(n.NOTEQUAL);break;default:n.depthFunc(n.LEQUAL)}W=ae}},setLocked:function(ae){N=ae},setClear:function(ae){J!==ae&&(n.clearDepth(ae),J=ae)},reset:function(){N=!1,k=null,W=null,J=null}}}function i(){let N=!1,B=null,k=null,W=null,J=null,ae=null,pe=null,xe=null,Le=null;return{setTest:function(Re){N||(Re?we(n.STENCIL_TEST):ye(n.STENCIL_TEST))},setMask:function(Re){B!==Re&&!N&&(n.stencilMask(Re),B=Re)},setFunc:function(Re,Ye,dn){(k!==Re||W!==Ye||J!==dn)&&(n.stencilFunc(Re,Ye,dn),k=Re,W=Ye,J=dn)},setOp:function(Re,Ye,dn){(ae!==Re||pe!==Ye||xe!==dn)&&(n.stencilOp(Re,Ye,dn),ae=Re,pe=Ye,xe=dn)},setLocked:function(Re){N=Re},setClear:function(Re){Le!==Re&&(n.clearStencil(Re),Le=Re)},reset:function(){N=!1,B=null,k=null,W=null,J=null,ae=null,pe=null,xe=null,Le=null}}}const r=new e,s=new t,o=new i,a=new WeakMap,l=new WeakMap;let c={},u={},d=new WeakMap,h=[],f=null,_=!1,v=null,g=null,m=null,y=null,S=null,M=null,R=null,A=new Ke(0,0,0),C=0,D=!1,$=null,b=null,E=null,F=null,O=null;const X=n.getParameter(n.MAX_COMBINED_TEXTURE_IMAGE_UNITS);let re=!1,K=0;const he=n.getParameter(n.VERSION);he.indexOf("WebGL")!==-1?(K=parseFloat(/^WebGL (\d)/.exec(he)[1]),re=K>=1):he.indexOf("OpenGL ES")!==-1&&(K=parseFloat(/^OpenGL ES (\d)/.exec(he)[1]),re=K>=2);let j=null,Ee={};const _e=n.getParameter(n.SCISSOR_BOX),Se=n.getParameter(n.VIEWPORT),Me=new Rt().fromArray(_e),ze=new Rt().fromArray(Se);function ue(N,B,k,W){const J=new Uint8Array(4),ae=n.createTexture();n.bindTexture(N,ae),n.texParameteri(N,n.TEXTURE_MIN_FILTER,n.NEAREST),n.texParameteri(N,n.TEXTURE_MAG_FILTER,n.NEAREST);for(let pe=0;pe<k;pe++)N===n.TEXTURE_3D||N===n.TEXTURE_2D_ARRAY?n.texImage3D(B,0,n.RGBA,1,1,W,0,n.RGBA,n.UNSIGNED_BYTE,J):n.texImage2D(B+pe,0,n.RGBA,1,1,0,n.RGBA,n.UNSIGNED_BYTE,J);return ae}const me={};me[n.TEXTURE_2D]=ue(n.TEXTURE_2D,n.TEXTURE_2D,1),me[n.TEXTURE_CUBE_MAP]=ue(n.TEXTURE_CUBE_MAP,n.TEXTURE_CUBE_MAP_POSITIVE_X,6),me[n.TEXTURE_2D_ARRAY]=ue(n.TEXTURE_2D_ARRAY,n.TEXTURE_2D_ARRAY,1,1),me[n.TEXTURE_3D]=ue(n.TEXTURE_3D,n.TEXTURE_3D,1,1),r.setClear(0,0,0,1),s.setClear(1),o.setClear(0),we(n.DEPTH_TEST),s.setFunc(ys),et(!1),Ze(Rd),we(n.CULL_FACE),G(er);function we(N){c[N]!==!0&&(n.enable(N),c[N]=!0)}function ye(N){c[N]!==!1&&(n.disable(N),c[N]=!1)}function Ve(N,B){return u[N]!==B?(n.bindFramebuffer(N,B),u[N]=B,N===n.DRAW_FRAMEBUFFER&&(u[n.FRAMEBUFFER]=B),N===n.FRAMEBUFFER&&(u[n.DRAW_FRAMEBUFFER]=B),!0):!1}function Ne(N,B){let k=h,W=!1;if(N){k=d.get(B),k===void 0&&(k=[],d.set(B,k));const J=N.textures;if(k.length!==J.length||k[0]!==n.COLOR_ATTACHMENT0){for(let ae=0,pe=J.length;ae<pe;ae++)k[ae]=n.COLOR_ATTACHMENT0+ae;k.length=J.length,W=!0}}else k[0]!==n.BACK&&(k[0]=n.BACK,W=!0);W&&n.drawBuffers(k)}function qe(N){return f!==N?(n.useProgram(N),f=N,!0):!1}const Be={[xr]:n.FUNC_ADD,[fg]:n.FUNC_SUBTRACT,[pg]:n.FUNC_REVERSE_SUBTRACT};Be[mg]=n.MIN,Be[gg]=n.MAX;const Ge={[_g]:n.ZERO,[vg]:n.ONE,[yg]:n.SRC_COLOR,[pc]:n.SRC_ALPHA,[Eg]:n.SRC_ALPHA_SATURATE,[Mg]:n.DST_COLOR,[bg]:n.DST_ALPHA,[xg]:n.ONE_MINUS_SRC_COLOR,[mc]:n.ONE_MINUS_SRC_ALPHA,[wg]:n.ONE_MINUS_DST_COLOR,[Sg]:n.ONE_MINUS_DST_ALPHA,[Tg]:n.CONSTANT_COLOR,[Ag]:n.ONE_MINUS_CONSTANT_COLOR,[Cg]:n.CONSTANT_ALPHA,[Pg]:n.ONE_MINUS_CONSTANT_ALPHA};function G(N,B,k,W,J,ae,pe,xe,Le,Re){if(N===er){_===!0&&(ye(n.BLEND),_=!1);return}if(_===!1&&(we(n.BLEND),_=!0),N!==hg){if(N!==v||Re!==D){if((g!==xr||S!==xr)&&(n.blendEquation(n.FUNC_ADD),g=xr,S=xr),Re)switch(N){case gs:n.blendFuncSeparate(n.ONE,n.ONE_MINUS_SRC_ALPHA,n.ONE,n.ONE_MINUS_SRC_ALPHA);break;case Ld:n.blendFunc(n.ONE,n.ONE);break;case Id:n.blendFuncSeparate(n.ZERO,n.ONE_MINUS_SRC_COLOR,n.ZERO,n.ONE);break;case Dd:n.blendFuncSeparate(n.ZERO,n.SRC_COLOR,n.ZERO,n.SRC_ALPHA);break;default:console.error("THREE.WebGLState: Invalid blending: ",N);break}else switch(N){case gs:n.blendFuncSeparate(n.SRC_ALPHA,n.ONE_MINUS_SRC_ALPHA,n.ONE,n.ONE_MINUS_SRC_ALPHA);break;case Ld:n.blendFunc(n.SRC_ALPHA,n.ONE);break;case Id:n.blendFuncSeparate(n.ZERO,n.ONE_MINUS_SRC_COLOR,n.ZERO,n.ONE);break;case Dd:n.blendFunc(n.ZERO,n.SRC_COLOR);break;default:console.error("THREE.WebGLState: Invalid blending: ",N);break}m=null,y=null,M=null,R=null,A.set(0,0,0),C=0,v=N,D=Re}return}J=J||B,ae=ae||k,pe=pe||W,(B!==g||J!==S)&&(n.blendEquationSeparate(Be[B],Be[J]),g=B,S=J),(k!==m||W!==y||ae!==M||pe!==R)&&(n.blendFuncSeparate(Ge[k],Ge[W],Ge[ae],Ge[pe]),m=k,y=W,M=ae,R=pe),(xe.equals(A)===!1||Le!==C)&&(n.blendColor(xe.r,xe.g,xe.b,Le),A.copy(xe),C=Le),v=N,D=!1}function vt(N,B){N.side===en?ye(n.CULL_FACE):we(n.CULL_FACE);let k=N.side===un;B&&(k=!k),et(k),N.blending===gs&&N.transparent===!1?G(er):G(N.blending,N.blendEquation,N.blendSrc,N.blendDst,N.blendEquationAlpha,N.blendSrcAlpha,N.blendDstAlpha,N.blendColor,N.blendAlpha,N.premultipliedAlpha),s.setFunc(N.depthFunc),s.setTest(N.depthTest),s.setMask(N.depthWrite),r.setMask(N.colorWrite);const W=N.stencilWrite;o.setTest(W),W&&(o.setMask(N.stencilWriteMask),o.setFunc(N.stencilFunc,N.stencilRef,N.stencilFuncMask),o.setOp(N.stencilFail,N.stencilZFail,N.stencilZPass)),at(N.polygonOffset,N.polygonOffsetFactor,N.polygonOffsetUnits),N.alphaToCoverage===!0?we(n.SAMPLE_ALPHA_TO_COVERAGE):ye(n.SAMPLE_ALPHA_TO_COVERAGE)}function et(N){$!==N&&(N?n.frontFace(n.CW):n.frontFace(n.CCW),$=N)}function Ze(N){N!==cg?(we(n.CULL_FACE),N!==b&&(N===Rd?n.cullFace(n.BACK):N===ug?n.cullFace(n.FRONT):n.cullFace(n.FRONT_AND_BACK))):ye(n.CULL_FACE),b=N}function We(N){N!==E&&(re&&n.lineWidth(N),E=N)}function at(N,B,k){N?(we(n.POLYGON_OFFSET_FILL),(F!==B||O!==k)&&(n.polygonOffset(B,k),F=B,O=k)):ye(n.POLYGON_OFFSET_FILL)}function He(N){N?we(n.SCISSOR_TEST):ye(n.SCISSOR_TEST)}function U(N){N===void 0&&(N=n.TEXTURE0+X-1),j!==N&&(n.activeTexture(N),j=N)}function P(N,B,k){k===void 0&&(j===null?k=n.TEXTURE0+X-1:k=j);let W=Ee[k];W===void 0&&(W={type:void 0,texture:void 0},Ee[k]=W),(W.type!==N||W.texture!==B)&&(j!==k&&(n.activeTexture(k),j=k),n.bindTexture(N,B||me[N]),W.type=N,W.texture=B)}function ne(){const N=Ee[j];N!==void 0&&N.type!==void 0&&(n.bindTexture(N.type,null),N.type=void 0,N.texture=void 0)}function fe(){try{n.compressedTexImage2D.apply(n,arguments)}catch(N){console.error("THREE.WebGLState:",N)}}function ge(){try{n.compressedTexImage3D.apply(n,arguments)}catch(N){console.error("THREE.WebGLState:",N)}}function de(){try{n.texSubImage2D.apply(n,arguments)}catch(N){console.error("THREE.WebGLState:",N)}}function Fe(){try{n.texSubImage3D.apply(n,arguments)}catch(N){console.error("THREE.WebGLState:",N)}}function be(){try{n.compressedTexSubImage2D.apply(n,arguments)}catch(N){console.error("THREE.WebGLState:",N)}}function Ae(){try{n.compressedTexSubImage3D.apply(n,arguments)}catch(N){console.error("THREE.WebGLState:",N)}}function T(){try{n.texStorage2D.apply(n,arguments)}catch(N){console.error("THREE.WebGLState:",N)}}function p(){try{n.texStorage3D.apply(n,arguments)}catch(N){console.error("THREE.WebGLState:",N)}}function H(){try{n.texImage2D.apply(n,arguments)}catch(N){console.error("THREE.WebGLState:",N)}}function ee(){try{n.texImage3D.apply(n,arguments)}catch(N){console.error("THREE.WebGLState:",N)}}function te(N){Me.equals(N)===!1&&(n.scissor(N.x,N.y,N.z,N.w),Me.copy(N))}function q(N){ze.equals(N)===!1&&(n.viewport(N.x,N.y,N.z,N.w),ze.copy(N))}function ce(N,B){let k=l.get(B);k===void 0&&(k=new WeakMap,l.set(B,k));let W=k.get(N);W===void 0&&(W=n.getUniformBlockIndex(B,N.name),k.set(N,W))}function w(N,B){const W=l.get(B).get(N);a.get(B)!==W&&(n.uniformBlockBinding(B,W,N.__bindingPointIndex),a.set(B,W))}function Y(){n.disable(n.BLEND),n.disable(n.CULL_FACE),n.disable(n.DEPTH_TEST),n.disable(n.POLYGON_OFFSET_FILL),n.disable(n.SCISSOR_TEST),n.disable(n.STENCIL_TEST),n.disable(n.SAMPLE_ALPHA_TO_COVERAGE),n.blendEquation(n.FUNC_ADD),n.blendFunc(n.ONE,n.ZERO),n.blendFuncSeparate(n.ONE,n.ZERO,n.ONE,n.ZERO),n.blendColor(0,0,0,0),n.colorMask(!0,!0,!0,!0),n.clearColor(0,0,0,0),n.depthMask(!0),n.depthFunc(n.LESS),n.clearDepth(1),n.stencilMask(4294967295),n.stencilFunc(n.ALWAYS,0,4294967295),n.stencilOp(n.KEEP,n.KEEP,n.KEEP),n.clearStencil(0),n.cullFace(n.BACK),n.frontFace(n.CCW),n.polygonOffset(0,0),n.activeTexture(n.TEXTURE0),n.bindFramebuffer(n.FRAMEBUFFER,null),n.bindFramebuffer(n.DRAW_FRAMEBUFFER,null),n.bindFramebuffer(n.READ_FRAMEBUFFER,null),n.useProgram(null),n.lineWidth(1),n.scissor(0,0,n.canvas.width,n.canvas.height),n.viewport(0,0,n.canvas.width,n.canvas.height),c={},j=null,Ee={},u={},d=new WeakMap,h=[],f=null,_=!1,v=null,g=null,m=null,y=null,S=null,M=null,R=null,A=new Ke(0,0,0),C=0,D=!1,$=null,b=null,E=null,F=null,O=null,Me.set(0,0,n.canvas.width,n.canvas.height),ze.set(0,0,n.canvas.width,n.canvas.height),r.reset(),s.reset(),o.reset()}return{buffers:{color:r,depth:s,stencil:o},enable:we,disable:ye,bindFramebuffer:Ve,drawBuffers:Ne,useProgram:qe,setBlending:G,setMaterial:vt,setFlipSided:et,setCullFace:Ze,setLineWidth:We,setPolygonOffset:at,setScissorTest:He,activeTexture:U,bindTexture:P,unbindTexture:ne,compressedTexImage2D:fe,compressedTexImage3D:ge,texImage2D:H,texImage3D:ee,updateUBOMapping:ce,uniformBlockBinding:w,texStorage2D:T,texStorage3D:p,texSubImage2D:de,texSubImage3D:Fe,compressedTexSubImage2D:be,compressedTexSubImage3D:Ae,scissor:te,viewport:q,reset:Y}}function wh(n,e,t,i){const r=hb(i);switch(t){case Zf:return n*e;case Jf:return n*e;case Qf:return n*e*2;case ep:return n*e/r.components*r.byteLength;case wu:return n*e/r.components*r.byteLength;case tp:return n*e*2/r.components*r.byteLength;case Eu:return n*e*2/r.components*r.byteLength;case Kf:return n*e*3/r.components*r.byteLength;case Vn:return n*e*4/r.components*r.byteLength;case Tu:return n*e*4/r.components*r.byteLength;case wa:case Ea:return Math.floor((n+3)/4)*Math.floor((e+3)/4)*8;case Ta:case Aa:return Math.floor((n+3)/4)*Math.floor((e+3)/4)*16;case Ac:case Pc:return Math.max(n,16)*Math.max(e,8)/4;case Tc:case Cc:return Math.max(n,8)*Math.max(e,8)/2;case Rc:case Lc:return Math.floor((n+3)/4)*Math.floor((e+3)/4)*8;case Ic:return Math.floor((n+3)/4)*Math.floor((e+3)/4)*16;case Dc:return Math.floor((n+3)/4)*Math.floor((e+3)/4)*16;case Nc:return Math.floor((n+4)/5)*Math.floor((e+3)/4)*16;case Uc:return Math.floor((n+4)/5)*Math.floor((e+4)/5)*16;case Fc:return Math.floor((n+5)/6)*Math.floor((e+4)/5)*16;case Oc:return Math.floor((n+5)/6)*Math.floor((e+5)/6)*16;case Bc:return Math.floor((n+7)/8)*Math.floor((e+4)/5)*16;case kc:return Math.floor((n+7)/8)*Math.floor((e+5)/6)*16;case zc:return Math.floor((n+7)/8)*Math.floor((e+7)/8)*16;case Hc:return Math.floor((n+9)/10)*Math.floor((e+4)/5)*16;case Vc:return Math.floor((n+9)/10)*Math.floor((e+5)/6)*16;case Gc:return Math.floor((n+9)/10)*Math.floor((e+7)/8)*16;case Wc:return Math.floor((n+9)/10)*Math.floor((e+9)/10)*16;case $c:return Math.floor((n+11)/12)*Math.floor((e+9)/10)*16;case Xc:return Math.floor((n+11)/12)*Math.floor((e+11)/12)*16;case Ca:case jc:case qc:return Math.ceil(n/4)*Math.ceil(e/4)*16;case np:case Yc:return Math.ceil(n/4)*Math.ceil(e/4)*8;case Zc:case Kc:return Math.ceil(n/4)*Math.ceil(e/4)*16}throw new Error(`Unable to determine texture byte length for ${t} format.`)}function hb(n){switch(n){case ci:case jf:return{byteLength:1,components:1};case co:case qf:case mo:return{byteLength:2,components:1};case Su:case Mu:return{byteLength:2,components:4};case Mr:case bu:case Ai:return{byteLength:4,components:1};case Yf:return{byteLength:4,components:3}}throw new Error(`Unknown texture type ${n}.`)}function fb(n,e,t,i,r,s,o){const a=e.has("WEBGL_multisampled_render_to_texture")?e.get("WEBGL_multisampled_render_to_texture"):null,l=typeof navigator>"u"?!1:/OculusBrowser/g.test(navigator.userAgent),c=new Xe,u=new WeakMap;let d;const h=new WeakMap;let f=!1;try{f=typeof OffscreenCanvas<"u"&&new OffscreenCanvas(1,1).getContext("2d")!==null}catch{}function _(U,P){return f?new OffscreenCanvas(U,P):ho("canvas")}function v(U,P,ne){let fe=1;const ge=He(U);if((ge.width>ne||ge.height>ne)&&(fe=ne/Math.max(ge.width,ge.height)),fe<1)if(typeof HTMLImageElement<"u"&&U instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&U instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&U instanceof ImageBitmap||typeof VideoFrame<"u"&&U instanceof VideoFrame){const de=Math.floor(fe*ge.width),Fe=Math.floor(fe*ge.height);d===void 0&&(d=_(de,Fe));const be=P?_(de,Fe):d;return be.width=de,be.height=Fe,be.getContext("2d").drawImage(U,0,0,de,Fe),console.warn("THREE.WebGLRenderer: Texture has been resized from ("+ge.width+"x"+ge.height+") to ("+de+"x"+Fe+")."),be}else return"data"in U&&console.warn("THREE.WebGLRenderer: Image in DataTexture is too big ("+ge.width+"x"+ge.height+")."),U;return U}function g(U){return U.generateMipmaps&&U.minFilter!==Hn&&U.minFilter!==zn}function m(U){n.generateMipmap(U)}function y(U,P,ne,fe,ge=!1){if(U!==null){if(n[U]!==void 0)return n[U];console.warn("THREE.WebGLRenderer: Attempt to use non-existing WebGL internal format '"+U+"'")}let de=P;if(P===n.RED&&(ne===n.FLOAT&&(de=n.R32F),ne===n.HALF_FLOAT&&(de=n.R16F),ne===n.UNSIGNED_BYTE&&(de=n.R8)),P===n.RED_INTEGER&&(ne===n.UNSIGNED_BYTE&&(de=n.R8UI),ne===n.UNSIGNED_SHORT&&(de=n.R16UI),ne===n.UNSIGNED_INT&&(de=n.R32UI),ne===n.BYTE&&(de=n.R8I),ne===n.SHORT&&(de=n.R16I),ne===n.INT&&(de=n.R32I)),P===n.RG&&(ne===n.FLOAT&&(de=n.RG32F),ne===n.HALF_FLOAT&&(de=n.RG16F),ne===n.UNSIGNED_BYTE&&(de=n.RG8)),P===n.RG_INTEGER&&(ne===n.UNSIGNED_BYTE&&(de=n.RG8UI),ne===n.UNSIGNED_SHORT&&(de=n.RG16UI),ne===n.UNSIGNED_INT&&(de=n.RG32UI),ne===n.BYTE&&(de=n.RG8I),ne===n.SHORT&&(de=n.RG16I),ne===n.INT&&(de=n.RG32I)),P===n.RGB_INTEGER&&(ne===n.UNSIGNED_BYTE&&(de=n.RGB8UI),ne===n.UNSIGNED_SHORT&&(de=n.RGB16UI),ne===n.UNSIGNED_INT&&(de=n.RGB32UI),ne===n.BYTE&&(de=n.RGB8I),ne===n.SHORT&&(de=n.RGB16I),ne===n.INT&&(de=n.RGB32I)),P===n.RGBA_INTEGER&&(ne===n.UNSIGNED_BYTE&&(de=n.RGBA8UI),ne===n.UNSIGNED_SHORT&&(de=n.RGBA16UI),ne===n.UNSIGNED_INT&&(de=n.RGBA32UI),ne===n.BYTE&&(de=n.RGBA8I),ne===n.SHORT&&(de=n.RGBA16I),ne===n.INT&&(de=n.RGBA32I)),P===n.RGB&&ne===n.UNSIGNED_INT_5_9_9_9_REV&&(de=n.RGB9_E5),P===n.RGBA){const Fe=ge?Da:ft.getTransfer(fe);ne===n.FLOAT&&(de=n.RGBA32F),ne===n.HALF_FLOAT&&(de=n.RGBA16F),ne===n.UNSIGNED_BYTE&&(de=Fe===bt?n.SRGB8_ALPHA8:n.RGBA8),ne===n.UNSIGNED_SHORT_4_4_4_4&&(de=n.RGBA4),ne===n.UNSIGNED_SHORT_5_5_5_1&&(de=n.RGB5_A1)}return(de===n.R16F||de===n.R32F||de===n.RG16F||de===n.RG32F||de===n.RGBA16F||de===n.RGBA32F)&&e.get("EXT_color_buffer_float"),de}function S(U,P){let ne;return U?P===null||P===Mr||P===Ss?ne=n.DEPTH24_STENCIL8:P===Ai?ne=n.DEPTH32F_STENCIL8:P===co&&(ne=n.DEPTH24_STENCIL8,console.warn("DepthTexture: 16 bit depth attachment is not supported with stencil. Using 24-bit attachment.")):P===null||P===Mr||P===Ss?ne=n.DEPTH_COMPONENT24:P===Ai?ne=n.DEPTH_COMPONENT32F:P===co&&(ne=n.DEPTH_COMPONENT16),ne}function M(U,P){return g(U)===!0||U.isFramebufferTexture&&U.minFilter!==Hn&&U.minFilter!==zn?Math.log2(Math.max(P.width,P.height))+1:U.mipmaps!==void 0&&U.mipmaps.length>0?U.mipmaps.length:U.isCompressedTexture&&Array.isArray(U.image)?P.mipmaps.length:1}function R(U){const P=U.target;P.removeEventListener("dispose",R),C(P),P.isVideoTexture&&u.delete(P)}function A(U){const P=U.target;P.removeEventListener("dispose",A),$(P)}function C(U){const P=i.get(U);if(P.__webglInit===void 0)return;const ne=U.source,fe=h.get(ne);if(fe){const ge=fe[P.__cacheKey];ge.usedTimes--,ge.usedTimes===0&&D(U),Object.keys(fe).length===0&&h.delete(ne)}i.remove(U)}function D(U){const P=i.get(U);n.deleteTexture(P.__webglTexture);const ne=U.source,fe=h.get(ne);delete fe[P.__cacheKey],o.memory.textures--}function $(U){const P=i.get(U);if(U.depthTexture&&U.depthTexture.dispose(),U.isWebGLCubeRenderTarget)for(let fe=0;fe<6;fe++){if(Array.isArray(P.__webglFramebuffer[fe]))for(let ge=0;ge<P.__webglFramebuffer[fe].length;ge++)n.deleteFramebuffer(P.__webglFramebuffer[fe][ge]);else n.deleteFramebuffer(P.__webglFramebuffer[fe]);P.__webglDepthbuffer&&n.deleteRenderbuffer(P.__webglDepthbuffer[fe])}else{if(Array.isArray(P.__webglFramebuffer))for(let fe=0;fe<P.__webglFramebuffer.length;fe++)n.deleteFramebuffer(P.__webglFramebuffer[fe]);else n.deleteFramebuffer(P.__webglFramebuffer);if(P.__webglDepthbuffer&&n.deleteRenderbuffer(P.__webglDepthbuffer),P.__webglMultisampledFramebuffer&&n.deleteFramebuffer(P.__webglMultisampledFramebuffer),P.__webglColorRenderbuffer)for(let fe=0;fe<P.__webglColorRenderbuffer.length;fe++)P.__webglColorRenderbuffer[fe]&&n.deleteRenderbuffer(P.__webglColorRenderbuffer[fe]);P.__webglDepthRenderbuffer&&n.deleteRenderbuffer(P.__webglDepthRenderbuffer)}const ne=U.textures;for(let fe=0,ge=ne.length;fe<ge;fe++){const de=i.get(ne[fe]);de.__webglTexture&&(n.deleteTexture(de.__webglTexture),o.memory.textures--),i.remove(ne[fe])}i.remove(U)}let b=0;function E(){b=0}function F(){const U=b;return U>=r.maxTextures&&console.warn("THREE.WebGLTextures: Trying to use "+U+" texture units while this GPU supports only "+r.maxTextures),b+=1,U}function O(U){const P=[];return P.push(U.wrapS),P.push(U.wrapT),P.push(U.wrapR||0),P.push(U.magFilter),P.push(U.minFilter),P.push(U.anisotropy),P.push(U.internalFormat),P.push(U.format),P.push(U.type),P.push(U.generateMipmaps),P.push(U.premultiplyAlpha),P.push(U.flipY),P.push(U.unpackAlignment),P.push(U.colorSpace),P.join()}function X(U,P){const ne=i.get(U);if(U.isVideoTexture&&We(U),U.isRenderTargetTexture===!1&&U.version>0&&ne.__version!==U.version){const fe=U.image;if(fe===null)console.warn("THREE.WebGLRenderer: Texture marked for update but no image data found.");else if(fe.complete===!1)console.warn("THREE.WebGLRenderer: Texture marked for update but image is incomplete");else{ze(ne,U,P);return}}t.bindTexture(n.TEXTURE_2D,ne.__webglTexture,n.TEXTURE0+P)}function re(U,P){const ne=i.get(U);if(U.version>0&&ne.__version!==U.version){ze(ne,U,P);return}t.bindTexture(n.TEXTURE_2D_ARRAY,ne.__webglTexture,n.TEXTURE0+P)}function K(U,P){const ne=i.get(U);if(U.version>0&&ne.__version!==U.version){ze(ne,U,P);return}t.bindTexture(n.TEXTURE_3D,ne.__webglTexture,n.TEXTURE0+P)}function he(U,P){const ne=i.get(U);if(U.version>0&&ne.__version!==U.version){ue(ne,U,P);return}t.bindTexture(n.TEXTURE_CUBE_MAP,ne.__webglTexture,n.TEXTURE0+P)}const j={[wi]:n.REPEAT,[Sr]:n.CLAMP_TO_EDGE,[Ec]:n.MIRRORED_REPEAT},Ee={[Hn]:n.NEAREST,[Bg]:n.NEAREST_MIPMAP_NEAREST,[Lo]:n.NEAREST_MIPMAP_LINEAR,[zn]:n.LINEAR,[ml]:n.LINEAR_MIPMAP_NEAREST,[Ki]:n.LINEAR_MIPMAP_LINEAR},_e={[Vg]:n.NEVER,[qg]:n.ALWAYS,[Gg]:n.LESS,[rp]:n.LEQUAL,[Wg]:n.EQUAL,[jg]:n.GEQUAL,[$g]:n.GREATER,[Xg]:n.NOTEQUAL};function Se(U,P){if(P.type===Ai&&e.has("OES_texture_float_linear")===!1&&(P.magFilter===zn||P.magFilter===ml||P.magFilter===Lo||P.magFilter===Ki||P.minFilter===zn||P.minFilter===ml||P.minFilter===Lo||P.minFilter===Ki)&&console.warn("THREE.WebGLRenderer: Unable to use linear filtering with floating point textures. OES_texture_float_linear not supported on this device."),n.texParameteri(U,n.TEXTURE_WRAP_S,j[P.wrapS]),n.texParameteri(U,n.TEXTURE_WRAP_T,j[P.wrapT]),(U===n.TEXTURE_3D||U===n.TEXTURE_2D_ARRAY)&&n.texParameteri(U,n.TEXTURE_WRAP_R,j[P.wrapR]),n.texParameteri(U,n.TEXTURE_MAG_FILTER,Ee[P.magFilter]),n.texParameteri(U,n.TEXTURE_MIN_FILTER,Ee[P.minFilter]),P.compareFunction&&(n.texParameteri(U,n.TEXTURE_COMPARE_MODE,n.COMPARE_REF_TO_TEXTURE),n.texParameteri(U,n.TEXTURE_COMPARE_FUNC,_e[P.compareFunction])),e.has("EXT_texture_filter_anisotropic")===!0){if(P.magFilter===Hn||P.minFilter!==Lo&&P.minFilter!==Ki||P.type===Ai&&e.has("OES_texture_float_linear")===!1)return;if(P.anisotropy>1||i.get(P).__currentAnisotropy){const ne=e.get("EXT_texture_filter_anisotropic");n.texParameterf(U,ne.TEXTURE_MAX_ANISOTROPY_EXT,Math.min(P.anisotropy,r.getMaxAnisotropy())),i.get(P).__currentAnisotropy=P.anisotropy}}}function Me(U,P){let ne=!1;U.__webglInit===void 0&&(U.__webglInit=!0,P.addEventListener("dispose",R));const fe=P.source;let ge=h.get(fe);ge===void 0&&(ge={},h.set(fe,ge));const de=O(P);if(de!==U.__cacheKey){ge[de]===void 0&&(ge[de]={texture:n.createTexture(),usedTimes:0},o.memory.textures++,ne=!0),ge[de].usedTimes++;const Fe=ge[U.__cacheKey];Fe!==void 0&&(ge[U.__cacheKey].usedTimes--,Fe.usedTimes===0&&D(P)),U.__cacheKey=de,U.__webglTexture=ge[de].texture}return ne}function ze(U,P,ne){let fe=n.TEXTURE_2D;(P.isDataArrayTexture||P.isCompressedArrayTexture)&&(fe=n.TEXTURE_2D_ARRAY),P.isData3DTexture&&(fe=n.TEXTURE_3D);const ge=Me(U,P),de=P.source;t.bindTexture(fe,U.__webglTexture,n.TEXTURE0+ne);const Fe=i.get(de);if(de.version!==Fe.__version||ge===!0){t.activeTexture(n.TEXTURE0+ne);const be=ft.getPrimaries(ft.workingColorSpace),Ae=P.colorSpace===oi?null:ft.getPrimaries(P.colorSpace),T=P.colorSpace===oi||be===Ae?n.NONE:n.BROWSER_DEFAULT_WEBGL;n.pixelStorei(n.UNPACK_FLIP_Y_WEBGL,P.flipY),n.pixelStorei(n.UNPACK_PREMULTIPLY_ALPHA_WEBGL,P.premultiplyAlpha),n.pixelStorei(n.UNPACK_ALIGNMENT,P.unpackAlignment),n.pixelStorei(n.UNPACK_COLORSPACE_CONVERSION_WEBGL,T);let p=v(P.image,!1,r.maxTextureSize);p=at(P,p);const H=s.convert(P.format,P.colorSpace),ee=s.convert(P.type);let te=y(P.internalFormat,H,ee,P.colorSpace,P.isVideoTexture);Se(fe,P);let q;const ce=P.mipmaps,w=P.isVideoTexture!==!0,Y=Fe.__version===void 0||ge===!0,N=de.dataReady,B=M(P,p);if(P.isDepthTexture)te=S(P.format===Ms,P.type),Y&&(w?t.texStorage2D(n.TEXTURE_2D,1,te,p.width,p.height):t.texImage2D(n.TEXTURE_2D,0,te,p.width,p.height,0,H,ee,null));else if(P.isDataTexture)if(ce.length>0){w&&Y&&t.texStorage2D(n.TEXTURE_2D,B,te,ce[0].width,ce[0].height);for(let k=0,W=ce.length;k<W;k++)q=ce[k],w?N&&t.texSubImage2D(n.TEXTURE_2D,k,0,0,q.width,q.height,H,ee,q.data):t.texImage2D(n.TEXTURE_2D,k,te,q.width,q.height,0,H,ee,q.data);P.generateMipmaps=!1}else w?(Y&&t.texStorage2D(n.TEXTURE_2D,B,te,p.width,p.height),N&&t.texSubImage2D(n.TEXTURE_2D,0,0,0,p.width,p.height,H,ee,p.data)):t.texImage2D(n.TEXTURE_2D,0,te,p.width,p.height,0,H,ee,p.data);else if(P.isCompressedTexture)if(P.isCompressedArrayTexture){w&&Y&&t.texStorage3D(n.TEXTURE_2D_ARRAY,B,te,ce[0].width,ce[0].height,p.depth);for(let k=0,W=ce.length;k<W;k++)if(q=ce[k],P.format!==Vn)if(H!==null)if(w){if(N)if(P.layerUpdates.size>0){const J=wh(q.width,q.height,P.format,P.type);for(const ae of P.layerUpdates){const pe=q.data.subarray(ae*J/q.data.BYTES_PER_ELEMENT,(ae+1)*J/q.data.BYTES_PER_ELEMENT);t.compressedTexSubImage3D(n.TEXTURE_2D_ARRAY,k,0,0,ae,q.width,q.height,1,H,pe,0,0)}P.clearLayerUpdates()}else t.compressedTexSubImage3D(n.TEXTURE_2D_ARRAY,k,0,0,0,q.width,q.height,p.depth,H,q.data,0,0)}else t.compressedTexImage3D(n.TEXTURE_2D_ARRAY,k,te,q.width,q.height,p.depth,0,q.data,0,0);else console.warn("THREE.WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()");else w?N&&t.texSubImage3D(n.TEXTURE_2D_ARRAY,k,0,0,0,q.width,q.height,p.depth,H,ee,q.data):t.texImage3D(n.TEXTURE_2D_ARRAY,k,te,q.width,q.height,p.depth,0,H,ee,q.data)}else{w&&Y&&t.texStorage2D(n.TEXTURE_2D,B,te,ce[0].width,ce[0].height);for(let k=0,W=ce.length;k<W;k++)q=ce[k],P.format!==Vn?H!==null?w?N&&t.compressedTexSubImage2D(n.TEXTURE_2D,k,0,0,q.width,q.height,H,q.data):t.compressedTexImage2D(n.TEXTURE_2D,k,te,q.width,q.height,0,q.data):console.warn("THREE.WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()"):w?N&&t.texSubImage2D(n.TEXTURE_2D,k,0,0,q.width,q.height,H,ee,q.data):t.texImage2D(n.TEXTURE_2D,k,te,q.width,q.height,0,H,ee,q.data)}else if(P.isDataArrayTexture)if(w){if(Y&&t.texStorage3D(n.TEXTURE_2D_ARRAY,B,te,p.width,p.height,p.depth),N)if(P.layerUpdates.size>0){const k=wh(p.width,p.height,P.format,P.type);for(const W of P.layerUpdates){const J=p.data.subarray(W*k/p.data.BYTES_PER_ELEMENT,(W+1)*k/p.data.BYTES_PER_ELEMENT);t.texSubImage3D(n.TEXTURE_2D_ARRAY,0,0,0,W,p.width,p.height,1,H,ee,J)}P.clearLayerUpdates()}else t.texSubImage3D(n.TEXTURE_2D_ARRAY,0,0,0,0,p.width,p.height,p.depth,H,ee,p.data)}else t.texImage3D(n.TEXTURE_2D_ARRAY,0,te,p.width,p.height,p.depth,0,H,ee,p.data);else if(P.isData3DTexture)w?(Y&&t.texStorage3D(n.TEXTURE_3D,B,te,p.width,p.height,p.depth),N&&t.texSubImage3D(n.TEXTURE_3D,0,0,0,0,p.width,p.height,p.depth,H,ee,p.data)):t.texImage3D(n.TEXTURE_3D,0,te,p.width,p.height,p.depth,0,H,ee,p.data);else if(P.isFramebufferTexture){if(Y)if(w)t.texStorage2D(n.TEXTURE_2D,B,te,p.width,p.height);else{let k=p.width,W=p.height;for(let J=0;J<B;J++)t.texImage2D(n.TEXTURE_2D,J,te,k,W,0,H,ee,null),k>>=1,W>>=1}}else if(ce.length>0){if(w&&Y){const k=He(ce[0]);t.texStorage2D(n.TEXTURE_2D,B,te,k.width,k.height)}for(let k=0,W=ce.length;k<W;k++)q=ce[k],w?N&&t.texSubImage2D(n.TEXTURE_2D,k,0,0,H,ee,q):t.texImage2D(n.TEXTURE_2D,k,te,H,ee,q);P.generateMipmaps=!1}else if(w){if(Y){const k=He(p);t.texStorage2D(n.TEXTURE_2D,B,te,k.width,k.height)}N&&t.texSubImage2D(n.TEXTURE_2D,0,0,0,H,ee,p)}else t.texImage2D(n.TEXTURE_2D,0,te,H,ee,p);g(P)&&m(fe),Fe.__version=de.version,P.onUpdate&&P.onUpdate(P)}U.__version=P.version}function ue(U,P,ne){if(P.image.length!==6)return;const fe=Me(U,P),ge=P.source;t.bindTexture(n.TEXTURE_CUBE_MAP,U.__webglTexture,n.TEXTURE0+ne);const de=i.get(ge);if(ge.version!==de.__version||fe===!0){t.activeTexture(n.TEXTURE0+ne);const Fe=ft.getPrimaries(ft.workingColorSpace),be=P.colorSpace===oi?null:ft.getPrimaries(P.colorSpace),Ae=P.colorSpace===oi||Fe===be?n.NONE:n.BROWSER_DEFAULT_WEBGL;n.pixelStorei(n.UNPACK_FLIP_Y_WEBGL,P.flipY),n.pixelStorei(n.UNPACK_PREMULTIPLY_ALPHA_WEBGL,P.premultiplyAlpha),n.pixelStorei(n.UNPACK_ALIGNMENT,P.unpackAlignment),n.pixelStorei(n.UNPACK_COLORSPACE_CONVERSION_WEBGL,Ae);const T=P.isCompressedTexture||P.image[0].isCompressedTexture,p=P.image[0]&&P.image[0].isDataTexture,H=[];for(let W=0;W<6;W++)!T&&!p?H[W]=v(P.image[W],!0,r.maxCubemapSize):H[W]=p?P.image[W].image:P.image[W],H[W]=at(P,H[W]);const ee=H[0],te=s.convert(P.format,P.colorSpace),q=s.convert(P.type),ce=y(P.internalFormat,te,q,P.colorSpace),w=P.isVideoTexture!==!0,Y=de.__version===void 0||fe===!0,N=ge.dataReady;let B=M(P,ee);Se(n.TEXTURE_CUBE_MAP,P);let k;if(T){w&&Y&&t.texStorage2D(n.TEXTURE_CUBE_MAP,B,ce,ee.width,ee.height);for(let W=0;W<6;W++){k=H[W].mipmaps;for(let J=0;J<k.length;J++){const ae=k[J];P.format!==Vn?te!==null?w?N&&t.compressedTexSubImage2D(n.TEXTURE_CUBE_MAP_POSITIVE_X+W,J,0,0,ae.width,ae.height,te,ae.data):t.compressedTexImage2D(n.TEXTURE_CUBE_MAP_POSITIVE_X+W,J,ce,ae.width,ae.height,0,ae.data):console.warn("THREE.WebGLRenderer: Attempt to load unsupported compressed texture format in .setTextureCube()"):w?N&&t.texSubImage2D(n.TEXTURE_CUBE_MAP_POSITIVE_X+W,J,0,0,ae.width,ae.height,te,q,ae.data):t.texImage2D(n.TEXTURE_CUBE_MAP_POSITIVE_X+W,J,ce,ae.width,ae.height,0,te,q,ae.data)}}}else{if(k=P.mipmaps,w&&Y){k.length>0&&B++;const W=He(H[0]);t.texStorage2D(n.TEXTURE_CUBE_MAP,B,ce,W.width,W.height)}for(let W=0;W<6;W++)if(p){w?N&&t.texSubImage2D(n.TEXTURE_CUBE_MAP_POSITIVE_X+W,0,0,0,H[W].width,H[W].height,te,q,H[W].data):t.texImage2D(n.TEXTURE_CUBE_MAP_POSITIVE_X+W,0,ce,H[W].width,H[W].height,0,te,q,H[W].data);for(let J=0;J<k.length;J++){const pe=k[J].image[W].image;w?N&&t.texSubImage2D(n.TEXTURE_CUBE_MAP_POSITIVE_X+W,J+1,0,0,pe.width,pe.height,te,q,pe.data):t.texImage2D(n.TEXTURE_CUBE_MAP_POSITIVE_X+W,J+1,ce,pe.width,pe.height,0,te,q,pe.data)}}else{w?N&&t.texSubImage2D(n.TEXTURE_CUBE_MAP_POSITIVE_X+W,0,0,0,te,q,H[W]):t.texImage2D(n.TEXTURE_CUBE_MAP_POSITIVE_X+W,0,ce,te,q,H[W]);for(let J=0;J<k.length;J++){const ae=k[J];w?N&&t.texSubImage2D(n.TEXTURE_CUBE_MAP_POSITIVE_X+W,J+1,0,0,te,q,ae.image[W]):t.texImage2D(n.TEXTURE_CUBE_MAP_POSITIVE_X+W,J+1,ce,te,q,ae.image[W])}}}g(P)&&m(n.TEXTURE_CUBE_MAP),de.__version=ge.version,P.onUpdate&&P.onUpdate(P)}U.__version=P.version}function me(U,P,ne,fe,ge,de){const Fe=s.convert(ne.format,ne.colorSpace),be=s.convert(ne.type),Ae=y(ne.internalFormat,Fe,be,ne.colorSpace);if(!i.get(P).__hasExternalTextures){const p=Math.max(1,P.width>>de),H=Math.max(1,P.height>>de);ge===n.TEXTURE_3D||ge===n.TEXTURE_2D_ARRAY?t.texImage3D(ge,de,Ae,p,H,P.depth,0,Fe,be,null):t.texImage2D(ge,de,Ae,p,H,0,Fe,be,null)}t.bindFramebuffer(n.FRAMEBUFFER,U),Ze(P)?a.framebufferTexture2DMultisampleEXT(n.FRAMEBUFFER,fe,ge,i.get(ne).__webglTexture,0,et(P)):(ge===n.TEXTURE_2D||ge>=n.TEXTURE_CUBE_MAP_POSITIVE_X&&ge<=n.TEXTURE_CUBE_MAP_NEGATIVE_Z)&&n.framebufferTexture2D(n.FRAMEBUFFER,fe,ge,i.get(ne).__webglTexture,de),t.bindFramebuffer(n.FRAMEBUFFER,null)}function we(U,P,ne){if(n.bindRenderbuffer(n.RENDERBUFFER,U),P.depthBuffer){const fe=P.depthTexture,ge=fe&&fe.isDepthTexture?fe.type:null,de=S(P.stencilBuffer,ge),Fe=P.stencilBuffer?n.DEPTH_STENCIL_ATTACHMENT:n.DEPTH_ATTACHMENT,be=et(P);Ze(P)?a.renderbufferStorageMultisampleEXT(n.RENDERBUFFER,be,de,P.width,P.height):ne?n.renderbufferStorageMultisample(n.RENDERBUFFER,be,de,P.width,P.height):n.renderbufferStorage(n.RENDERBUFFER,de,P.width,P.height),n.framebufferRenderbuffer(n.FRAMEBUFFER,Fe,n.RENDERBUFFER,U)}else{const fe=P.textures;for(let ge=0;ge<fe.length;ge++){const de=fe[ge],Fe=s.convert(de.format,de.colorSpace),be=s.convert(de.type),Ae=y(de.internalFormat,Fe,be,de.colorSpace),T=et(P);ne&&Ze(P)===!1?n.renderbufferStorageMultisample(n.RENDERBUFFER,T,Ae,P.width,P.height):Ze(P)?a.renderbufferStorageMultisampleEXT(n.RENDERBUFFER,T,Ae,P.width,P.height):n.renderbufferStorage(n.RENDERBUFFER,Ae,P.width,P.height)}}n.bindRenderbuffer(n.RENDERBUFFER,null)}function ye(U,P){if(P&&P.isWebGLCubeRenderTarget)throw new Error("Depth Texture with cube render targets is not supported");if(t.bindFramebuffer(n.FRAMEBUFFER,U),!(P.depthTexture&&P.depthTexture.isDepthTexture))throw new Error("renderTarget.depthTexture must be an instance of THREE.DepthTexture");(!i.get(P.depthTexture).__webglTexture||P.depthTexture.image.width!==P.width||P.depthTexture.image.height!==P.height)&&(P.depthTexture.image.width=P.width,P.depthTexture.image.height=P.height,P.depthTexture.needsUpdate=!0),X(P.depthTexture,0);const fe=i.get(P.depthTexture).__webglTexture,ge=et(P);if(P.depthTexture.format===_s)Ze(P)?a.framebufferTexture2DMultisampleEXT(n.FRAMEBUFFER,n.DEPTH_ATTACHMENT,n.TEXTURE_2D,fe,0,ge):n.framebufferTexture2D(n.FRAMEBUFFER,n.DEPTH_ATTACHMENT,n.TEXTURE_2D,fe,0);else if(P.depthTexture.format===Ms)Ze(P)?a.framebufferTexture2DMultisampleEXT(n.FRAMEBUFFER,n.DEPTH_STENCIL_ATTACHMENT,n.TEXTURE_2D,fe,0,ge):n.framebufferTexture2D(n.FRAMEBUFFER,n.DEPTH_STENCIL_ATTACHMENT,n.TEXTURE_2D,fe,0);else throw new Error("Unknown depthTexture format")}function Ve(U){const P=i.get(U),ne=U.isWebGLCubeRenderTarget===!0;if(P.__boundDepthTexture!==U.depthTexture){const fe=U.depthTexture;if(P.__depthDisposeCallback&&P.__depthDisposeCallback(),fe){const ge=()=>{delete P.__boundDepthTexture,delete P.__depthDisposeCallback,fe.removeEventListener("dispose",ge)};fe.addEventListener("dispose",ge),P.__depthDisposeCallback=ge}P.__boundDepthTexture=fe}if(U.depthTexture&&!P.__autoAllocateDepthBuffer){if(ne)throw new Error("target.depthTexture not supported in Cube render targets");ye(P.__webglFramebuffer,U)}else if(ne){P.__webglDepthbuffer=[];for(let fe=0;fe<6;fe++)if(t.bindFramebuffer(n.FRAMEBUFFER,P.__webglFramebuffer[fe]),P.__webglDepthbuffer[fe]===void 0)P.__webglDepthbuffer[fe]=n.createRenderbuffer(),we(P.__webglDepthbuffer[fe],U,!1);else{const ge=U.stencilBuffer?n.DEPTH_STENCIL_ATTACHMENT:n.DEPTH_ATTACHMENT,de=P.__webglDepthbuffer[fe];n.bindRenderbuffer(n.RENDERBUFFER,de),n.framebufferRenderbuffer(n.FRAMEBUFFER,ge,n.RENDERBUFFER,de)}}else if(t.bindFramebuffer(n.FRAMEBUFFER,P.__webglFramebuffer),P.__webglDepthbuffer===void 0)P.__webglDepthbuffer=n.createRenderbuffer(),we(P.__webglDepthbuffer,U,!1);else{const fe=U.stencilBuffer?n.DEPTH_STENCIL_ATTACHMENT:n.DEPTH_ATTACHMENT,ge=P.__webglDepthbuffer;n.bindRenderbuffer(n.RENDERBUFFER,ge),n.framebufferRenderbuffer(n.FRAMEBUFFER,fe,n.RENDERBUFFER,ge)}t.bindFramebuffer(n.FRAMEBUFFER,null)}function Ne(U,P,ne){const fe=i.get(U);P!==void 0&&me(fe.__webglFramebuffer,U,U.texture,n.COLOR_ATTACHMENT0,n.TEXTURE_2D,0),ne!==void 0&&Ve(U)}function qe(U){const P=U.texture,ne=i.get(U),fe=i.get(P);U.addEventListener("dispose",A);const ge=U.textures,de=U.isWebGLCubeRenderTarget===!0,Fe=ge.length>1;if(Fe||(fe.__webglTexture===void 0&&(fe.__webglTexture=n.createTexture()),fe.__version=P.version,o.memory.textures++),de){ne.__webglFramebuffer=[];for(let be=0;be<6;be++)if(P.mipmaps&&P.mipmaps.length>0){ne.__webglFramebuffer[be]=[];for(let Ae=0;Ae<P.mipmaps.length;Ae++)ne.__webglFramebuffer[be][Ae]=n.createFramebuffer()}else ne.__webglFramebuffer[be]=n.createFramebuffer()}else{if(P.mipmaps&&P.mipmaps.length>0){ne.__webglFramebuffer=[];for(let be=0;be<P.mipmaps.length;be++)ne.__webglFramebuffer[be]=n.createFramebuffer()}else ne.__webglFramebuffer=n.createFramebuffer();if(Fe)for(let be=0,Ae=ge.length;be<Ae;be++){const T=i.get(ge[be]);T.__webglTexture===void 0&&(T.__webglTexture=n.createTexture(),o.memory.textures++)}if(U.samples>0&&Ze(U)===!1){ne.__webglMultisampledFramebuffer=n.createFramebuffer(),ne.__webglColorRenderbuffer=[],t.bindFramebuffer(n.FRAMEBUFFER,ne.__webglMultisampledFramebuffer);for(let be=0;be<ge.length;be++){const Ae=ge[be];ne.__webglColorRenderbuffer[be]=n.createRenderbuffer(),n.bindRenderbuffer(n.RENDERBUFFER,ne.__webglColorRenderbuffer[be]);const T=s.convert(Ae.format,Ae.colorSpace),p=s.convert(Ae.type),H=y(Ae.internalFormat,T,p,Ae.colorSpace,U.isXRRenderTarget===!0),ee=et(U);n.renderbufferStorageMultisample(n.RENDERBUFFER,ee,H,U.width,U.height),n.framebufferRenderbuffer(n.FRAMEBUFFER,n.COLOR_ATTACHMENT0+be,n.RENDERBUFFER,ne.__webglColorRenderbuffer[be])}n.bindRenderbuffer(n.RENDERBUFFER,null),U.depthBuffer&&(ne.__webglDepthRenderbuffer=n.createRenderbuffer(),we(ne.__webglDepthRenderbuffer,U,!0)),t.bindFramebuffer(n.FRAMEBUFFER,null)}}if(de){t.bindTexture(n.TEXTURE_CUBE_MAP,fe.__webglTexture),Se(n.TEXTURE_CUBE_MAP,P);for(let be=0;be<6;be++)if(P.mipmaps&&P.mipmaps.length>0)for(let Ae=0;Ae<P.mipmaps.length;Ae++)me(ne.__webglFramebuffer[be][Ae],U,P,n.COLOR_ATTACHMENT0,n.TEXTURE_CUBE_MAP_POSITIVE_X+be,Ae);else me(ne.__webglFramebuffer[be],U,P,n.COLOR_ATTACHMENT0,n.TEXTURE_CUBE_MAP_POSITIVE_X+be,0);g(P)&&m(n.TEXTURE_CUBE_MAP),t.unbindTexture()}else if(Fe){for(let be=0,Ae=ge.length;be<Ae;be++){const T=ge[be],p=i.get(T);t.bindTexture(n.TEXTURE_2D,p.__webglTexture),Se(n.TEXTURE_2D,T),me(ne.__webglFramebuffer,U,T,n.COLOR_ATTACHMENT0+be,n.TEXTURE_2D,0),g(T)&&m(n.TEXTURE_2D)}t.unbindTexture()}else{let be=n.TEXTURE_2D;if((U.isWebGL3DRenderTarget||U.isWebGLArrayRenderTarget)&&(be=U.isWebGL3DRenderTarget?n.TEXTURE_3D:n.TEXTURE_2D_ARRAY),t.bindTexture(be,fe.__webglTexture),Se(be,P),P.mipmaps&&P.mipmaps.length>0)for(let Ae=0;Ae<P.mipmaps.length;Ae++)me(ne.__webglFramebuffer[Ae],U,P,n.COLOR_ATTACHMENT0,be,Ae);else me(ne.__webglFramebuffer,U,P,n.COLOR_ATTACHMENT0,be,0);g(P)&&m(be),t.unbindTexture()}U.depthBuffer&&Ve(U)}function Be(U){const P=U.textures;for(let ne=0,fe=P.length;ne<fe;ne++){const ge=P[ne];if(g(ge)){const de=U.isWebGLCubeRenderTarget?n.TEXTURE_CUBE_MAP:n.TEXTURE_2D,Fe=i.get(ge).__webglTexture;t.bindTexture(de,Fe),m(de),t.unbindTexture()}}}const Ge=[],G=[];function vt(U){if(U.samples>0){if(Ze(U)===!1){const P=U.textures,ne=U.width,fe=U.height;let ge=n.COLOR_BUFFER_BIT;const de=U.stencilBuffer?n.DEPTH_STENCIL_ATTACHMENT:n.DEPTH_ATTACHMENT,Fe=i.get(U),be=P.length>1;if(be)for(let Ae=0;Ae<P.length;Ae++)t.bindFramebuffer(n.FRAMEBUFFER,Fe.__webglMultisampledFramebuffer),n.framebufferRenderbuffer(n.FRAMEBUFFER,n.COLOR_ATTACHMENT0+Ae,n.RENDERBUFFER,null),t.bindFramebuffer(n.FRAMEBUFFER,Fe.__webglFramebuffer),n.framebufferTexture2D(n.DRAW_FRAMEBUFFER,n.COLOR_ATTACHMENT0+Ae,n.TEXTURE_2D,null,0);t.bindFramebuffer(n.READ_FRAMEBUFFER,Fe.__webglMultisampledFramebuffer),t.bindFramebuffer(n.DRAW_FRAMEBUFFER,Fe.__webglFramebuffer);for(let Ae=0;Ae<P.length;Ae++){if(U.resolveDepthBuffer&&(U.depthBuffer&&(ge|=n.DEPTH_BUFFER_BIT),U.stencilBuffer&&U.resolveStencilBuffer&&(ge|=n.STENCIL_BUFFER_BIT)),be){n.framebufferRenderbuffer(n.READ_FRAMEBUFFER,n.COLOR_ATTACHMENT0,n.RENDERBUFFER,Fe.__webglColorRenderbuffer[Ae]);const T=i.get(P[Ae]).__webglTexture;n.framebufferTexture2D(n.DRAW_FRAMEBUFFER,n.COLOR_ATTACHMENT0,n.TEXTURE_2D,T,0)}n.blitFramebuffer(0,0,ne,fe,0,0,ne,fe,ge,n.NEAREST),l===!0&&(Ge.length=0,G.length=0,Ge.push(n.COLOR_ATTACHMENT0+Ae),U.depthBuffer&&U.resolveDepthBuffer===!1&&(Ge.push(de),G.push(de),n.invalidateFramebuffer(n.DRAW_FRAMEBUFFER,G)),n.invalidateFramebuffer(n.READ_FRAMEBUFFER,Ge))}if(t.bindFramebuffer(n.READ_FRAMEBUFFER,null),t.bindFramebuffer(n.DRAW_FRAMEBUFFER,null),be)for(let Ae=0;Ae<P.length;Ae++){t.bindFramebuffer(n.FRAMEBUFFER,Fe.__webglMultisampledFramebuffer),n.framebufferRenderbuffer(n.FRAMEBUFFER,n.COLOR_ATTACHMENT0+Ae,n.RENDERBUFFER,Fe.__webglColorRenderbuffer[Ae]);const T=i.get(P[Ae]).__webglTexture;t.bindFramebuffer(n.FRAMEBUFFER,Fe.__webglFramebuffer),n.framebufferTexture2D(n.DRAW_FRAMEBUFFER,n.COLOR_ATTACHMENT0+Ae,n.TEXTURE_2D,T,0)}t.bindFramebuffer(n.DRAW_FRAMEBUFFER,Fe.__webglMultisampledFramebuffer)}else if(U.depthBuffer&&U.resolveDepthBuffer===!1&&l){const P=U.stencilBuffer?n.DEPTH_STENCIL_ATTACHMENT:n.DEPTH_ATTACHMENT;n.invalidateFramebuffer(n.DRAW_FRAMEBUFFER,[P])}}}function et(U){return Math.min(r.maxSamples,U.samples)}function Ze(U){const P=i.get(U);return U.samples>0&&e.has("WEBGL_multisampled_render_to_texture")===!0&&P.__useRenderToTexture!==!1}function We(U){const P=o.render.frame;u.get(U)!==P&&(u.set(U,P),U.update())}function at(U,P){const ne=U.colorSpace,fe=U.format,ge=U.type;return U.isCompressedTexture===!0||U.isVideoTexture===!0||ne!==rr&&ne!==oi&&(ft.getTransfer(ne)===bt?(fe!==Vn||ge!==ci)&&console.warn("THREE.WebGLTextures: sRGB encoded textures have to use RGBAFormat and UnsignedByteType."):console.error("THREE.WebGLTextures: Unsupported texture color space:",ne)),P}function He(U){return typeof HTMLImageElement<"u"&&U instanceof HTMLImageElement?(c.width=U.naturalWidth||U.width,c.height=U.naturalHeight||U.height):typeof VideoFrame<"u"&&U instanceof VideoFrame?(c.width=U.displayWidth,c.height=U.displayHeight):(c.width=U.width,c.height=U.height),c}this.allocateTextureUnit=F,this.resetTextureUnits=E,this.setTexture2D=X,this.setTexture2DArray=re,this.setTexture3D=K,this.setTextureCube=he,this.rebindTextures=Ne,this.setupRenderTarget=qe,this.updateRenderTargetMipmap=Be,this.updateMultisampleRenderTarget=vt,this.setupDepthRenderbuffer=Ve,this.setupFrameBufferTexture=me,this.useMultisampledRTT=Ze}function pb(n,e){function t(i,r=oi){let s;const o=ft.getTransfer(r);if(i===ci)return n.UNSIGNED_BYTE;if(i===Su)return n.UNSIGNED_SHORT_4_4_4_4;if(i===Mu)return n.UNSIGNED_SHORT_5_5_5_1;if(i===Yf)return n.UNSIGNED_INT_5_9_9_9_REV;if(i===jf)return n.BYTE;if(i===qf)return n.SHORT;if(i===co)return n.UNSIGNED_SHORT;if(i===bu)return n.INT;if(i===Mr)return n.UNSIGNED_INT;if(i===Ai)return n.FLOAT;if(i===mo)return n.HALF_FLOAT;if(i===Zf)return n.ALPHA;if(i===Kf)return n.RGB;if(i===Vn)return n.RGBA;if(i===Jf)return n.LUMINANCE;if(i===Qf)return n.LUMINANCE_ALPHA;if(i===_s)return n.DEPTH_COMPONENT;if(i===Ms)return n.DEPTH_STENCIL;if(i===ep)return n.RED;if(i===wu)return n.RED_INTEGER;if(i===tp)return n.RG;if(i===Eu)return n.RG_INTEGER;if(i===Tu)return n.RGBA_INTEGER;if(i===wa||i===Ea||i===Ta||i===Aa)if(o===bt)if(s=e.get("WEBGL_compressed_texture_s3tc_srgb"),s!==null){if(i===wa)return s.COMPRESSED_SRGB_S3TC_DXT1_EXT;if(i===Ea)return s.COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT;if(i===Ta)return s.COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT;if(i===Aa)return s.COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT}else return null;else if(s=e.get("WEBGL_compressed_texture_s3tc"),s!==null){if(i===wa)return s.COMPRESSED_RGB_S3TC_DXT1_EXT;if(i===Ea)return s.COMPRESSED_RGBA_S3TC_DXT1_EXT;if(i===Ta)return s.COMPRESSED_RGBA_S3TC_DXT3_EXT;if(i===Aa)return s.COMPRESSED_RGBA_S3TC_DXT5_EXT}else return null;if(i===Tc||i===Ac||i===Cc||i===Pc)if(s=e.get("WEBGL_compressed_texture_pvrtc"),s!==null){if(i===Tc)return s.COMPRESSED_RGB_PVRTC_4BPPV1_IMG;if(i===Ac)return s.COMPRESSED_RGB_PVRTC_2BPPV1_IMG;if(i===Cc)return s.COMPRESSED_RGBA_PVRTC_4BPPV1_IMG;if(i===Pc)return s.COMPRESSED_RGBA_PVRTC_2BPPV1_IMG}else return null;if(i===Rc||i===Lc||i===Ic)if(s=e.get("WEBGL_compressed_texture_etc"),s!==null){if(i===Rc||i===Lc)return o===bt?s.COMPRESSED_SRGB8_ETC2:s.COMPRESSED_RGB8_ETC2;if(i===Ic)return o===bt?s.COMPRESSED_SRGB8_ALPHA8_ETC2_EAC:s.COMPRESSED_RGBA8_ETC2_EAC}else return null;if(i===Dc||i===Nc||i===Uc||i===Fc||i===Oc||i===Bc||i===kc||i===zc||i===Hc||i===Vc||i===Gc||i===Wc||i===$c||i===Xc)if(s=e.get("WEBGL_compressed_texture_astc"),s!==null){if(i===Dc)return o===bt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR:s.COMPRESSED_RGBA_ASTC_4x4_KHR;if(i===Nc)return o===bt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_5x4_KHR:s.COMPRESSED_RGBA_ASTC_5x4_KHR;if(i===Uc)return o===bt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_5x5_KHR:s.COMPRESSED_RGBA_ASTC_5x5_KHR;if(i===Fc)return o===bt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_6x5_KHR:s.COMPRESSED_RGBA_ASTC_6x5_KHR;if(i===Oc)return o===bt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_6x6_KHR:s.COMPRESSED_RGBA_ASTC_6x6_KHR;if(i===Bc)return o===bt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_8x5_KHR:s.COMPRESSED_RGBA_ASTC_8x5_KHR;if(i===kc)return o===bt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_8x6_KHR:s.COMPRESSED_RGBA_ASTC_8x6_KHR;if(i===zc)return o===bt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_8x8_KHR:s.COMPRESSED_RGBA_ASTC_8x8_KHR;if(i===Hc)return o===bt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x5_KHR:s.COMPRESSED_RGBA_ASTC_10x5_KHR;if(i===Vc)return o===bt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x6_KHR:s.COMPRESSED_RGBA_ASTC_10x6_KHR;if(i===Gc)return o===bt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x8_KHR:s.COMPRESSED_RGBA_ASTC_10x8_KHR;if(i===Wc)return o===bt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x10_KHR:s.COMPRESSED_RGBA_ASTC_10x10_KHR;if(i===$c)return o===bt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_12x10_KHR:s.COMPRESSED_RGBA_ASTC_12x10_KHR;if(i===Xc)return o===bt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_12x12_KHR:s.COMPRESSED_RGBA_ASTC_12x12_KHR}else return null;if(i===Ca||i===jc||i===qc)if(s=e.get("EXT_texture_compression_bptc"),s!==null){if(i===Ca)return o===bt?s.COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT:s.COMPRESSED_RGBA_BPTC_UNORM_EXT;if(i===jc)return s.COMPRESSED_RGB_BPTC_SIGNED_FLOAT_EXT;if(i===qc)return s.COMPRESSED_RGB_BPTC_UNSIGNED_FLOAT_EXT}else return null;if(i===np||i===Yc||i===Zc||i===Kc)if(s=e.get("EXT_texture_compression_rgtc"),s!==null){if(i===Ca)return s.COMPRESSED_RED_RGTC1_EXT;if(i===Yc)return s.COMPRESSED_SIGNED_RED_RGTC1_EXT;if(i===Zc)return s.COMPRESSED_RED_GREEN_RGTC2_EXT;if(i===Kc)return s.COMPRESSED_SIGNED_RED_GREEN_RGTC2_EXT}else return null;return i===Ss?n.UNSIGNED_INT_24_8:n[i]!==void 0?n[i]:null}return{convert:t}}class mb extends kn{constructor(e=[]){super(),this.isArrayCamera=!0,this.cameras=e}}class Pi extends Jt{constructor(){super(),this.isGroup=!0,this.type="Group"}}const gb={type:"move"};class Gl{constructor(){this._targetRay=null,this._grip=null,this._hand=null}getHandSpace(){return this._hand===null&&(this._hand=new Pi,this._hand.matrixAutoUpdate=!1,this._hand.visible=!1,this._hand.joints={},this._hand.inputState={pinching:!1}),this._hand}getTargetRaySpace(){return this._targetRay===null&&(this._targetRay=new Pi,this._targetRay.matrixAutoUpdate=!1,this._targetRay.visible=!1,this._targetRay.hasLinearVelocity=!1,this._targetRay.linearVelocity=new z,this._targetRay.hasAngularVelocity=!1,this._targetRay.angularVelocity=new z),this._targetRay}getGripSpace(){return this._grip===null&&(this._grip=new Pi,this._grip.matrixAutoUpdate=!1,this._grip.visible=!1,this._grip.hasLinearVelocity=!1,this._grip.linearVelocity=new z,this._grip.hasAngularVelocity=!1,this._grip.angularVelocity=new z),this._grip}dispatchEvent(e){return this._targetRay!==null&&this._targetRay.dispatchEvent(e),this._grip!==null&&this._grip.dispatchEvent(e),this._hand!==null&&this._hand.dispatchEvent(e),this}connect(e){if(e&&e.hand){const t=this._hand;if(t)for(const i of e.hand.values())this._getHandJoint(t,i)}return this.dispatchEvent({type:"connected",data:e}),this}disconnect(e){return this.dispatchEvent({type:"disconnected",data:e}),this._targetRay!==null&&(this._targetRay.visible=!1),this._grip!==null&&(this._grip.visible=!1),this._hand!==null&&(this._hand.visible=!1),this}update(e,t,i){let r=null,s=null,o=null;const a=this._targetRay,l=this._grip,c=this._hand;if(e&&t.session.visibilityState!=="visible-blurred"){if(c&&e.hand){o=!0;for(const v of e.hand.values()){const g=t.getJointPose(v,i),m=this._getHandJoint(c,v);g!==null&&(m.matrix.fromArray(g.transform.matrix),m.matrix.decompose(m.position,m.rotation,m.scale),m.matrixWorldNeedsUpdate=!0,m.jointRadius=g.radius),m.visible=g!==null}const u=c.joints["index-finger-tip"],d=c.joints["thumb-tip"],h=u.position.distanceTo(d.position),f=.02,_=.005;c.inputState.pinching&&h>f+_?(c.inputState.pinching=!1,this.dispatchEvent({type:"pinchend",handedness:e.handedness,target:this})):!c.inputState.pinching&&h<=f-_&&(c.inputState.pinching=!0,this.dispatchEvent({type:"pinchstart",handedness:e.handedness,target:this}))}else l!==null&&e.gripSpace&&(s=t.getPose(e.gripSpace,i),s!==null&&(l.matrix.fromArray(s.transform.matrix),l.matrix.decompose(l.position,l.rotation,l.scale),l.matrixWorldNeedsUpdate=!0,s.linearVelocity?(l.hasLinearVelocity=!0,l.linearVelocity.copy(s.linearVelocity)):l.hasLinearVelocity=!1,s.angularVelocity?(l.hasAngularVelocity=!0,l.angularVelocity.copy(s.angularVelocity)):l.hasAngularVelocity=!1));a!==null&&(r=t.getPose(e.targetRaySpace,i),r===null&&s!==null&&(r=s),r!==null&&(a.matrix.fromArray(r.transform.matrix),a.matrix.decompose(a.position,a.rotation,a.scale),a.matrixWorldNeedsUpdate=!0,r.linearVelocity?(a.hasLinearVelocity=!0,a.linearVelocity.copy(r.linearVelocity)):a.hasLinearVelocity=!1,r.angularVelocity?(a.hasAngularVelocity=!0,a.angularVelocity.copy(r.angularVelocity)):a.hasAngularVelocity=!1,this.dispatchEvent(gb)))}return a!==null&&(a.visible=r!==null),l!==null&&(l.visible=s!==null),c!==null&&(c.visible=o!==null),this}_getHandJoint(e,t){if(e.joints[t.jointName]===void 0){const i=new Pi;i.matrixAutoUpdate=!1,i.visible=!1,e.joints[t.jointName]=i,e.add(i)}return e.joints[t.jointName]}}const _b=`
void main() {

	gl_Position = vec4( position, 1.0 );

}`,vb=`
uniform sampler2DArray depthColor;
uniform float depthWidth;
uniform float depthHeight;

void main() {

	vec2 coord = vec2( gl_FragCoord.x / depthWidth, gl_FragCoord.y / depthHeight );

	if ( coord.x >= 1.0 ) {

		gl_FragDepth = texture( depthColor, vec3( coord.x - 1.0, coord.y, 1 ) ).r;

	} else {

		gl_FragDepth = texture( depthColor, vec3( coord.x, coord.y, 0 ) ).r;

	}

}`;class yb{constructor(){this.texture=null,this.mesh=null,this.depthNear=0,this.depthFar=0}init(e,t,i){if(this.texture===null){const r=new nn,s=e.properties.get(r);s.__webglTexture=t.texture,(t.depthNear!=i.depthNear||t.depthFar!=i.depthFar)&&(this.depthNear=t.depthNear,this.depthFar=t.depthFar),this.texture=r}}getMesh(e){if(this.texture!==null&&this.mesh===null){const t=e.cameras[0].viewport,i=new Dn({vertexShader:_b,fragmentShader:vb,uniforms:{depthColor:{value:this.texture},depthWidth:{value:t.z},depthHeight:{value:t.w}}});this.mesh=new gn(new $a(20,20),i)}return this.mesh}reset(){this.texture=null,this.mesh=null}getDepthTexture(){return this.texture}}class xb extends Er{constructor(e,t){super();const i=this;let r=null,s=1,o=null,a="local-floor",l=1,c=null,u=null,d=null,h=null,f=null,_=null;const v=new yb,g=t.getContextAttributes();let m=null,y=null;const S=[],M=[],R=new Xe;let A=null;const C=new kn;C.layers.enable(1),C.viewport=new Rt;const D=new kn;D.layers.enable(2),D.viewport=new Rt;const $=[C,D],b=new mb;b.layers.enable(1),b.layers.enable(2);let E=null,F=null;this.cameraAutoUpdate=!0,this.enabled=!1,this.isPresenting=!1,this.getController=function(ue){let me=S[ue];return me===void 0&&(me=new Gl,S[ue]=me),me.getTargetRaySpace()},this.getControllerGrip=function(ue){let me=S[ue];return me===void 0&&(me=new Gl,S[ue]=me),me.getGripSpace()},this.getHand=function(ue){let me=S[ue];return me===void 0&&(me=new Gl,S[ue]=me),me.getHandSpace()};function O(ue){const me=M.indexOf(ue.inputSource);if(me===-1)return;const we=S[me];we!==void 0&&(we.update(ue.inputSource,ue.frame,c||o),we.dispatchEvent({type:ue.type,data:ue.inputSource}))}function X(){r.removeEventListener("select",O),r.removeEventListener("selectstart",O),r.removeEventListener("selectend",O),r.removeEventListener("squeeze",O),r.removeEventListener("squeezestart",O),r.removeEventListener("squeezeend",O),r.removeEventListener("end",X),r.removeEventListener("inputsourceschange",re);for(let ue=0;ue<S.length;ue++){const me=M[ue];me!==null&&(M[ue]=null,S[ue].disconnect(me))}E=null,F=null,v.reset(),e.setRenderTarget(m),f=null,h=null,d=null,r=null,y=null,ze.stop(),i.isPresenting=!1,e.setPixelRatio(A),e.setSize(R.width,R.height,!1),i.dispatchEvent({type:"sessionend"})}this.setFramebufferScaleFactor=function(ue){s=ue,i.isPresenting===!0&&console.warn("THREE.WebXRManager: Cannot change framebuffer scale while presenting.")},this.setReferenceSpaceType=function(ue){a=ue,i.isPresenting===!0&&console.warn("THREE.WebXRManager: Cannot change reference space type while presenting.")},this.getReferenceSpace=function(){return c||o},this.setReferenceSpace=function(ue){c=ue},this.getBaseLayer=function(){return h!==null?h:f},this.getBinding=function(){return d},this.getFrame=function(){return _},this.getSession=function(){return r},this.setSession=async function(ue){if(r=ue,r!==null){if(m=e.getRenderTarget(),r.addEventListener("select",O),r.addEventListener("selectstart",O),r.addEventListener("selectend",O),r.addEventListener("squeeze",O),r.addEventListener("squeezestart",O),r.addEventListener("squeezeend",O),r.addEventListener("end",X),r.addEventListener("inputsourceschange",re),g.xrCompatible!==!0&&await t.makeXRCompatible(),A=e.getPixelRatio(),e.getSize(R),r.renderState.layers===void 0){const me={antialias:g.antialias,alpha:!0,depth:g.depth,stencil:g.stencil,framebufferScaleFactor:s};f=new XRWebGLLayer(r,t,me),r.updateRenderState({baseLayer:f}),e.setPixelRatio(1),e.setSize(f.framebufferWidth,f.framebufferHeight,!1),y=new nr(f.framebufferWidth,f.framebufferHeight,{format:Vn,type:ci,colorSpace:e.outputColorSpace,stencilBuffer:g.stencil})}else{let me=null,we=null,ye=null;g.depth&&(ye=g.stencil?t.DEPTH24_STENCIL8:t.DEPTH_COMPONENT24,me=g.stencil?Ms:_s,we=g.stencil?Ss:Mr);const Ve={colorFormat:t.RGBA8,depthFormat:ye,scaleFactor:s};d=new XRWebGLBinding(r,t),h=d.createProjectionLayer(Ve),r.updateRenderState({layers:[h]}),e.setPixelRatio(1),e.setSize(h.textureWidth,h.textureHeight,!1),y=new nr(h.textureWidth,h.textureHeight,{format:Vn,type:ci,depthTexture:new gp(h.textureWidth,h.textureHeight,we,void 0,void 0,void 0,void 0,void 0,void 0,me),stencilBuffer:g.stencil,colorSpace:e.outputColorSpace,samples:g.antialias?4:0,resolveDepthBuffer:h.ignoreDepthValues===!1})}y.isXRRenderTarget=!0,this.setFoveation(l),c=null,o=await r.requestReferenceSpace(a),ze.setContext(r),ze.start(),i.isPresenting=!0,i.dispatchEvent({type:"sessionstart"})}},this.getEnvironmentBlendMode=function(){if(r!==null)return r.environmentBlendMode},this.getDepthTexture=function(){return v.getDepthTexture()};function re(ue){for(let me=0;me<ue.removed.length;me++){const we=ue.removed[me],ye=M.indexOf(we);ye>=0&&(M[ye]=null,S[ye].disconnect(we))}for(let me=0;me<ue.added.length;me++){const we=ue.added[me];let ye=M.indexOf(we);if(ye===-1){for(let Ne=0;Ne<S.length;Ne++)if(Ne>=M.length){M.push(we),ye=Ne;break}else if(M[Ne]===null){M[Ne]=we,ye=Ne;break}if(ye===-1)break}const Ve=S[ye];Ve&&Ve.connect(we)}}const K=new z,he=new z;function j(ue,me,we){K.setFromMatrixPosition(me.matrixWorld),he.setFromMatrixPosition(we.matrixWorld);const ye=K.distanceTo(he),Ve=me.projectionMatrix.elements,Ne=we.projectionMatrix.elements,qe=Ve[14]/(Ve[10]-1),Be=Ve[14]/(Ve[10]+1),Ge=(Ve[9]+1)/Ve[5],G=(Ve[9]-1)/Ve[5],vt=(Ve[8]-1)/Ve[0],et=(Ne[8]+1)/Ne[0],Ze=qe*vt,We=qe*et,at=ye/(-vt+et),He=at*-vt;if(me.matrixWorld.decompose(ue.position,ue.quaternion,ue.scale),ue.translateX(He),ue.translateZ(at),ue.matrixWorld.compose(ue.position,ue.quaternion,ue.scale),ue.matrixWorldInverse.copy(ue.matrixWorld).invert(),Ve[10]===-1)ue.projectionMatrix.copy(me.projectionMatrix),ue.projectionMatrixInverse.copy(me.projectionMatrixInverse);else{const U=qe+at,P=Be+at,ne=Ze-He,fe=We+(ye-He),ge=Ge*Be/P*U,de=G*Be/P*U;ue.projectionMatrix.makePerspective(ne,fe,ge,de,U,P),ue.projectionMatrixInverse.copy(ue.projectionMatrix).invert()}}function Ee(ue,me){me===null?ue.matrixWorld.copy(ue.matrix):ue.matrixWorld.multiplyMatrices(me.matrixWorld,ue.matrix),ue.matrixWorldInverse.copy(ue.matrixWorld).invert()}this.updateCamera=function(ue){if(r===null)return;let me=ue.near,we=ue.far;v.texture!==null&&(v.depthNear>0&&(me=v.depthNear),v.depthFar>0&&(we=v.depthFar)),b.near=D.near=C.near=me,b.far=D.far=C.far=we,(E!==b.near||F!==b.far)&&(r.updateRenderState({depthNear:b.near,depthFar:b.far}),E=b.near,F=b.far);const ye=ue.parent,Ve=b.cameras;Ee(b,ye);for(let Ne=0;Ne<Ve.length;Ne++)Ee(Ve[Ne],ye);Ve.length===2?j(b,C,D):b.projectionMatrix.copy(C.projectionMatrix),_e(ue,b,ye)};function _e(ue,me,we){we===null?ue.matrix.copy(me.matrixWorld):(ue.matrix.copy(we.matrixWorld),ue.matrix.invert(),ue.matrix.multiply(me.matrixWorld)),ue.matrix.decompose(ue.position,ue.quaternion,ue.scale),ue.updateMatrixWorld(!0),ue.projectionMatrix.copy(me.projectionMatrix),ue.projectionMatrixInverse.copy(me.projectionMatrixInverse),ue.isPerspectiveCamera&&(ue.fov=uo*2*Math.atan(1/ue.projectionMatrix.elements[5]),ue.zoom=1)}this.getCamera=function(){return b},this.getFoveation=function(){if(!(h===null&&f===null))return l},this.setFoveation=function(ue){l=ue,h!==null&&(h.fixedFoveation=ue),f!==null&&f.fixedFoveation!==void 0&&(f.fixedFoveation=ue)},this.hasDepthSensing=function(){return v.texture!==null},this.getDepthSensingMesh=function(){return v.getMesh(b)};let Se=null;function Me(ue,me){if(u=me.getViewerPose(c||o),_=me,u!==null){const we=u.views;f!==null&&(e.setRenderTargetFramebuffer(y,f.framebuffer),e.setRenderTarget(y));let ye=!1;we.length!==b.cameras.length&&(b.cameras.length=0,ye=!0);for(let Ne=0;Ne<we.length;Ne++){const qe=we[Ne];let Be=null;if(f!==null)Be=f.getViewport(qe);else{const G=d.getViewSubImage(h,qe);Be=G.viewport,Ne===0&&(e.setRenderTargetTextures(y,G.colorTexture,h.ignoreDepthValues?void 0:G.depthStencilTexture),e.setRenderTarget(y))}let Ge=$[Ne];Ge===void 0&&(Ge=new kn,Ge.layers.enable(Ne),Ge.viewport=new Rt,$[Ne]=Ge),Ge.matrix.fromArray(qe.transform.matrix),Ge.matrix.decompose(Ge.position,Ge.quaternion,Ge.scale),Ge.projectionMatrix.fromArray(qe.projectionMatrix),Ge.projectionMatrixInverse.copy(Ge.projectionMatrix).invert(),Ge.viewport.set(Be.x,Be.y,Be.width,Be.height),Ne===0&&(b.matrix.copy(Ge.matrix),b.matrix.decompose(b.position,b.quaternion,b.scale)),ye===!0&&b.cameras.push(Ge)}const Ve=r.enabledFeatures;if(Ve&&Ve.includes("depth-sensing")){const Ne=d.getDepthInformation(we[0]);Ne&&Ne.isValid&&Ne.texture&&v.init(e,Ne,r.renderState)}}for(let we=0;we<S.length;we++){const ye=M[we],Ve=S[we];ye!==null&&Ve!==void 0&&Ve.update(ye,me,c||o)}Se&&Se(ue,me),me.detectedPlanes&&i.dispatchEvent({type:"planesdetected",data:me}),_=null}const ze=new pp;ze.setAnimationLoop(Me),this.setAnimationLoop=function(ue){Se=ue},this.dispose=function(){}}}const mr=new ui,bb=new ht;function Sb(n,e){function t(g,m){g.matrixAutoUpdate===!0&&g.updateMatrix(),m.value.copy(g.matrix)}function i(g,m){m.color.getRGB(g.fogColor.value,up(n)),m.isFog?(g.fogNear.value=m.near,g.fogFar.value=m.far):m.isFogExp2&&(g.fogDensity.value=m.density)}function r(g,m,y,S,M){m.isMeshBasicMaterial||m.isMeshLambertMaterial?s(g,m):m.isMeshToonMaterial?(s(g,m),d(g,m)):m.isMeshPhongMaterial?(s(g,m),u(g,m)):m.isMeshStandardMaterial?(s(g,m),h(g,m),m.isMeshPhysicalMaterial&&f(g,m,M)):m.isMeshMatcapMaterial?(s(g,m),_(g,m)):m.isMeshDepthMaterial?s(g,m):m.isMeshDistanceMaterial?(s(g,m),v(g,m)):m.isMeshNormalMaterial?s(g,m):m.isLineBasicMaterial?(o(g,m),m.isLineDashedMaterial&&a(g,m)):m.isPointsMaterial?l(g,m,y,S):m.isSpriteMaterial?c(g,m):m.isShadowMaterial?(g.color.value.copy(m.color),g.opacity.value=m.opacity):m.isShaderMaterial&&(m.uniformsNeedUpdate=!1)}function s(g,m){g.opacity.value=m.opacity,m.color&&g.diffuse.value.copy(m.color),m.emissive&&g.emissive.value.copy(m.emissive).multiplyScalar(m.emissiveIntensity),m.map&&(g.map.value=m.map,t(m.map,g.mapTransform)),m.alphaMap&&(g.alphaMap.value=m.alphaMap,t(m.alphaMap,g.alphaMapTransform)),m.bumpMap&&(g.bumpMap.value=m.bumpMap,t(m.bumpMap,g.bumpMapTransform),g.bumpScale.value=m.bumpScale,m.side===un&&(g.bumpScale.value*=-1)),m.normalMap&&(g.normalMap.value=m.normalMap,t(m.normalMap,g.normalMapTransform),g.normalScale.value.copy(m.normalScale),m.side===un&&g.normalScale.value.negate()),m.displacementMap&&(g.displacementMap.value=m.displacementMap,t(m.displacementMap,g.displacementMapTransform),g.displacementScale.value=m.displacementScale,g.displacementBias.value=m.displacementBias),m.emissiveMap&&(g.emissiveMap.value=m.emissiveMap,t(m.emissiveMap,g.emissiveMapTransform)),m.specularMap&&(g.specularMap.value=m.specularMap,t(m.specularMap,g.specularMapTransform)),m.alphaTest>0&&(g.alphaTest.value=m.alphaTest);const y=e.get(m),S=y.envMap,M=y.envMapRotation;S&&(g.envMap.value=S,mr.copy(M),mr.x*=-1,mr.y*=-1,mr.z*=-1,S.isCubeTexture&&S.isRenderTargetTexture===!1&&(mr.y*=-1,mr.z*=-1),g.envMapRotation.value.setFromMatrix4(bb.makeRotationFromEuler(mr)),g.flipEnvMap.value=S.isCubeTexture&&S.isRenderTargetTexture===!1?-1:1,g.reflectivity.value=m.reflectivity,g.ior.value=m.ior,g.refractionRatio.value=m.refractionRatio),m.lightMap&&(g.lightMap.value=m.lightMap,g.lightMapIntensity.value=m.lightMapIntensity,t(m.lightMap,g.lightMapTransform)),m.aoMap&&(g.aoMap.value=m.aoMap,g.aoMapIntensity.value=m.aoMapIntensity,t(m.aoMap,g.aoMapTransform))}function o(g,m){g.diffuse.value.copy(m.color),g.opacity.value=m.opacity,m.map&&(g.map.value=m.map,t(m.map,g.mapTransform))}function a(g,m){g.dashSize.value=m.dashSize,g.totalSize.value=m.dashSize+m.gapSize,g.scale.value=m.scale}function l(g,m,y,S){g.diffuse.value.copy(m.color),g.opacity.value=m.opacity,g.size.value=m.size*y,g.scale.value=S*.5,m.map&&(g.map.value=m.map,t(m.map,g.uvTransform)),m.alphaMap&&(g.alphaMap.value=m.alphaMap,t(m.alphaMap,g.alphaMapTransform)),m.alphaTest>0&&(g.alphaTest.value=m.alphaTest)}function c(g,m){g.diffuse.value.copy(m.color),g.opacity.value=m.opacity,g.rotation.value=m.rotation,m.map&&(g.map.value=m.map,t(m.map,g.mapTransform)),m.alphaMap&&(g.alphaMap.value=m.alphaMap,t(m.alphaMap,g.alphaMapTransform)),m.alphaTest>0&&(g.alphaTest.value=m.alphaTest)}function u(g,m){g.specular.value.copy(m.specular),g.shininess.value=Math.max(m.shininess,1e-4)}function d(g,m){m.gradientMap&&(g.gradientMap.value=m.gradientMap)}function h(g,m){g.metalness.value=m.metalness,m.metalnessMap&&(g.metalnessMap.value=m.metalnessMap,t(m.metalnessMap,g.metalnessMapTransform)),g.roughness.value=m.roughness,m.roughnessMap&&(g.roughnessMap.value=m.roughnessMap,t(m.roughnessMap,g.roughnessMapTransform)),m.envMap&&(g.envMapIntensity.value=m.envMapIntensity)}function f(g,m,y){g.ior.value=m.ior,m.sheen>0&&(g.sheenColor.value.copy(m.sheenColor).multiplyScalar(m.sheen),g.sheenRoughness.value=m.sheenRoughness,m.sheenColorMap&&(g.sheenColorMap.value=m.sheenColorMap,t(m.sheenColorMap,g.sheenColorMapTransform)),m.sheenRoughnessMap&&(g.sheenRoughnessMap.value=m.sheenRoughnessMap,t(m.sheenRoughnessMap,g.sheenRoughnessMapTransform))),m.clearcoat>0&&(g.clearcoat.value=m.clearcoat,g.clearcoatRoughness.value=m.clearcoatRoughness,m.clearcoatMap&&(g.clearcoatMap.value=m.clearcoatMap,t(m.clearcoatMap,g.clearcoatMapTransform)),m.clearcoatRoughnessMap&&(g.clearcoatRoughnessMap.value=m.clearcoatRoughnessMap,t(m.clearcoatRoughnessMap,g.clearcoatRoughnessMapTransform)),m.clearcoatNormalMap&&(g.clearcoatNormalMap.value=m.clearcoatNormalMap,t(m.clearcoatNormalMap,g.clearcoatNormalMapTransform),g.clearcoatNormalScale.value.copy(m.clearcoatNormalScale),m.side===un&&g.clearcoatNormalScale.value.negate())),m.dispersion>0&&(g.dispersion.value=m.dispersion),m.iridescence>0&&(g.iridescence.value=m.iridescence,g.iridescenceIOR.value=m.iridescenceIOR,g.iridescenceThicknessMinimum.value=m.iridescenceThicknessRange[0],g.iridescenceThicknessMaximum.value=m.iridescenceThicknessRange[1],m.iridescenceMap&&(g.iridescenceMap.value=m.iridescenceMap,t(m.iridescenceMap,g.iridescenceMapTransform)),m.iridescenceThicknessMap&&(g.iridescenceThicknessMap.value=m.iridescenceThicknessMap,t(m.iridescenceThicknessMap,g.iridescenceThicknessMapTransform))),m.transmission>0&&(g.transmission.value=m.transmission,g.transmissionSamplerMap.value=y.texture,g.transmissionSamplerSize.value.set(y.width,y.height),m.transmissionMap&&(g.transmissionMap.value=m.transmissionMap,t(m.transmissionMap,g.transmissionMapTransform)),g.thickness.value=m.thickness,m.thicknessMap&&(g.thicknessMap.value=m.thicknessMap,t(m.thicknessMap,g.thicknessMapTransform)),g.attenuationDistance.value=m.attenuationDistance,g.attenuationColor.value.copy(m.attenuationColor)),m.anisotropy>0&&(g.anisotropyVector.value.set(m.anisotropy*Math.cos(m.anisotropyRotation),m.anisotropy*Math.sin(m.anisotropyRotation)),m.anisotropyMap&&(g.anisotropyMap.value=m.anisotropyMap,t(m.anisotropyMap,g.anisotropyMapTransform))),g.specularIntensity.value=m.specularIntensity,g.specularColor.value.copy(m.specularColor),m.specularColorMap&&(g.specularColorMap.value=m.specularColorMap,t(m.specularColorMap,g.specularColorMapTransform)),m.specularIntensityMap&&(g.specularIntensityMap.value=m.specularIntensityMap,t(m.specularIntensityMap,g.specularIntensityMapTransform))}function _(g,m){m.matcap&&(g.matcap.value=m.matcap)}function v(g,m){const y=e.get(m).light;g.referencePosition.value.setFromMatrixPosition(y.matrixWorld),g.nearDistance.value=y.shadow.camera.near,g.farDistance.value=y.shadow.camera.far}return{refreshFogUniforms:i,refreshMaterialUniforms:r}}function Mb(n,e,t,i){let r={},s={},o=[];const a=n.getParameter(n.MAX_UNIFORM_BUFFER_BINDINGS);function l(y,S){const M=S.program;i.uniformBlockBinding(y,M)}function c(y,S){let M=r[y.id];M===void 0&&(_(y),M=u(y),r[y.id]=M,y.addEventListener("dispose",g));const R=S.program;i.updateUBOMapping(y,R);const A=e.render.frame;s[y.id]!==A&&(h(y),s[y.id]=A)}function u(y){const S=d();y.__bindingPointIndex=S;const M=n.createBuffer(),R=y.__size,A=y.usage;return n.bindBuffer(n.UNIFORM_BUFFER,M),n.bufferData(n.UNIFORM_BUFFER,R,A),n.bindBuffer(n.UNIFORM_BUFFER,null),n.bindBufferBase(n.UNIFORM_BUFFER,S,M),M}function d(){for(let y=0;y<a;y++)if(o.indexOf(y)===-1)return o.push(y),y;return console.error("THREE.WebGLRenderer: Maximum number of simultaneously usable uniforms groups reached."),0}function h(y){const S=r[y.id],M=y.uniforms,R=y.__cache;n.bindBuffer(n.UNIFORM_BUFFER,S);for(let A=0,C=M.length;A<C;A++){const D=Array.isArray(M[A])?M[A]:[M[A]];for(let $=0,b=D.length;$<b;$++){const E=D[$];if(f(E,A,$,R)===!0){const F=E.__offset,O=Array.isArray(E.value)?E.value:[E.value];let X=0;for(let re=0;re<O.length;re++){const K=O[re],he=v(K);typeof K=="number"||typeof K=="boolean"?(E.__data[0]=K,n.bufferSubData(n.UNIFORM_BUFFER,F+X,E.__data)):K.isMatrix3?(E.__data[0]=K.elements[0],E.__data[1]=K.elements[1],E.__data[2]=K.elements[2],E.__data[3]=0,E.__data[4]=K.elements[3],E.__data[5]=K.elements[4],E.__data[6]=K.elements[5],E.__data[7]=0,E.__data[8]=K.elements[6],E.__data[9]=K.elements[7],E.__data[10]=K.elements[8],E.__data[11]=0):(K.toArray(E.__data,X),X+=he.storage/Float32Array.BYTES_PER_ELEMENT)}n.bufferSubData(n.UNIFORM_BUFFER,F,E.__data)}}}n.bindBuffer(n.UNIFORM_BUFFER,null)}function f(y,S,M,R){const A=y.value,C=S+"_"+M;if(R[C]===void 0)return typeof A=="number"||typeof A=="boolean"?R[C]=A:R[C]=A.clone(),!0;{const D=R[C];if(typeof A=="number"||typeof A=="boolean"){if(D!==A)return R[C]=A,!0}else if(D.equals(A)===!1)return D.copy(A),!0}return!1}function _(y){const S=y.uniforms;let M=0;const R=16;for(let C=0,D=S.length;C<D;C++){const $=Array.isArray(S[C])?S[C]:[S[C]];for(let b=0,E=$.length;b<E;b++){const F=$[b],O=Array.isArray(F.value)?F.value:[F.value];for(let X=0,re=O.length;X<re;X++){const K=O[X],he=v(K),j=M%R,Ee=j%he.boundary,_e=j+Ee;M+=Ee,_e!==0&&R-_e<he.storage&&(M+=R-_e),F.__data=new Float32Array(he.storage/Float32Array.BYTES_PER_ELEMENT),F.__offset=M,M+=he.storage}}}const A=M%R;return A>0&&(M+=R-A),y.__size=M,y.__cache={},this}function v(y){const S={boundary:0,storage:0};return typeof y=="number"||typeof y=="boolean"?(S.boundary=4,S.storage=4):y.isVector2?(S.boundary=8,S.storage=8):y.isVector3||y.isColor?(S.boundary=16,S.storage=12):y.isVector4?(S.boundary=16,S.storage=16):y.isMatrix3?(S.boundary=48,S.storage=48):y.isMatrix4?(S.boundary=64,S.storage=64):y.isTexture?console.warn("THREE.WebGLRenderer: Texture samplers can not be part of an uniforms group."):console.warn("THREE.WebGLRenderer: Unsupported uniform value type.",y),S}function g(y){const S=y.target;S.removeEventListener("dispose",g);const M=o.indexOf(S.__bindingPointIndex);o.splice(M,1),n.deleteBuffer(r[S.id]),delete r[S.id],delete s[S.id]}function m(){for(const y in r)n.deleteBuffer(r[y]);o=[],r={},s={}}return{bind:l,update:c,dispose:m}}class wb{constructor(e={}){const{canvas:t=d0(),context:i=null,depth:r=!0,stencil:s=!1,alpha:o=!1,antialias:a=!1,premultipliedAlpha:l=!0,preserveDrawingBuffer:c=!1,powerPreference:u="default",failIfMajorPerformanceCaveat:d=!1}=e;this.isWebGLRenderer=!0;let h;if(i!==null){if(typeof WebGLRenderingContext<"u"&&i instanceof WebGLRenderingContext)throw new Error("THREE.WebGLRenderer: WebGL 1 is not supported since r163.");h=i.getContextAttributes().alpha}else h=o;const f=new Uint32Array(4),_=new Int32Array(4);let v=null,g=null;const m=[],y=[];this.domElement=t,this.debug={checkShaderErrors:!0,onShaderError:null},this.autoClear=!0,this.autoClearColor=!0,this.autoClearDepth=!0,this.autoClearStencil=!0,this.sortObjects=!0,this.clippingPlanes=[],this.localClippingEnabled=!1,this._outputColorSpace=Ln,this.toneMapping=tr,this.toneMappingExposure=1;const S=this;let M=!1,R=0,A=0,C=null,D=-1,$=null;const b=new Rt,E=new Rt;let F=null;const O=new Ke(0);let X=0,re=t.width,K=t.height,he=1,j=null,Ee=null;const _e=new Rt(0,0,re,K),Se=new Rt(0,0,re,K);let Me=!1;const ze=new fp;let ue=!1,me=!1;const we=new ht,ye=new ht,Ve=new z,Ne=new Rt,qe={background:null,fog:null,environment:null,overrideMaterial:null,isScene:!0};let Be=!1;function Ge(){return C===null?he:1}let G=i;function vt(L,Z){return t.getContext(L,Z)}try{const L={alpha:!0,depth:r,stencil:s,antialias:a,premultipliedAlpha:l,preserveDrawingBuffer:c,powerPreference:u,failIfMajorPerformanceCaveat:d};if("setAttribute"in t&&t.setAttribute("data-engine",`three.js r${po}`),t.addEventListener("webglcontextlost",W,!1),t.addEventListener("webglcontextrestored",J,!1),t.addEventListener("webglcontextcreationerror",ae,!1),G===null){const Z="webgl2";if(G=vt(Z,L),G===null)throw vt(Z)?new Error("Error creating WebGL context with your selected attributes."):new Error("Error creating WebGL context.")}}catch(L){throw console.error("THREE.WebGLRenderer: "+L.message),L}let et,Ze,We,at,He,U,P,ne,fe,ge,de,Fe,be,Ae,T,p,H,ee,te,q,ce,w,Y,N;function B(){et=new Py(G),et.init(),w=new pb(G,et),Ze=new My(G,et,e,w),We=new db(G),Ze.reverseDepthBuffer&&We.buffers.depth.setReversed(!0),at=new Iy(G),He=new Zx,U=new fb(G,et,We,He,Ze,w,at),P=new Ey(S),ne=new Cy(S),fe=new k0(G),Y=new by(G,fe),ge=new Ry(G,fe,at,Y),de=new Ny(G,ge,fe,at),te=new Dy(G,Ze,U),p=new wy(He),Fe=new Yx(S,P,ne,et,Ze,Y,p),be=new Sb(S,He),Ae=new Jx,T=new rb(et),ee=new xy(S,P,ne,We,de,h,l),H=new cb(S,de,Ze),N=new Mb(G,at,Ze,We),q=new Sy(G,et,at),ce=new Ly(G,et,at),at.programs=Fe.programs,S.capabilities=Ze,S.extensions=et,S.properties=He,S.renderLists=Ae,S.shadowMap=H,S.state=We,S.info=at}B();const k=new xb(S,G);this.xr=k,this.getContext=function(){return G},this.getContextAttributes=function(){return G.getContextAttributes()},this.forceContextLoss=function(){const L=et.get("WEBGL_lose_context");L&&L.loseContext()},this.forceContextRestore=function(){const L=et.get("WEBGL_lose_context");L&&L.restoreContext()},this.getPixelRatio=function(){return he},this.setPixelRatio=function(L){L!==void 0&&(he=L,this.setSize(re,K,!1))},this.getSize=function(L){return L.set(re,K)},this.setSize=function(L,Z,ie=!0){if(k.isPresenting){console.warn("THREE.WebGLRenderer: Can't change size while VR device is presenting.");return}re=L,K=Z,t.width=Math.floor(L*he),t.height=Math.floor(Z*he),ie===!0&&(t.style.width=L+"px",t.style.height=Z+"px"),this.setViewport(0,0,L,Z)},this.getDrawingBufferSize=function(L){return L.set(re*he,K*he).floor()},this.setDrawingBufferSize=function(L,Z,ie){re=L,K=Z,he=ie,t.width=Math.floor(L*ie),t.height=Math.floor(Z*ie),this.setViewport(0,0,L,Z)},this.getCurrentViewport=function(L){return L.copy(b)},this.getViewport=function(L){return L.copy(_e)},this.setViewport=function(L,Z,ie,oe){L.isVector4?_e.set(L.x,L.y,L.z,L.w):_e.set(L,Z,ie,oe),We.viewport(b.copy(_e).multiplyScalar(he).round())},this.getScissor=function(L){return L.copy(Se)},this.setScissor=function(L,Z,ie,oe){L.isVector4?Se.set(L.x,L.y,L.z,L.w):Se.set(L,Z,ie,oe),We.scissor(E.copy(Se).multiplyScalar(he).round())},this.getScissorTest=function(){return Me},this.setScissorTest=function(L){We.setScissorTest(Me=L)},this.setOpaqueSort=function(L){j=L},this.setTransparentSort=function(L){Ee=L},this.getClearColor=function(L){return L.copy(ee.getClearColor())},this.setClearColor=function(){ee.setClearColor.apply(ee,arguments)},this.getClearAlpha=function(){return ee.getClearAlpha()},this.setClearAlpha=function(){ee.setClearAlpha.apply(ee,arguments)},this.clear=function(L=!0,Z=!0,ie=!0){let oe=0;if(L){let Q=!1;if(C!==null){const ve=C.texture.format;Q=ve===Tu||ve===Eu||ve===wu}if(Q){const ve=C.texture.type,Pe=ve===ci||ve===Mr||ve===co||ve===Ss||ve===Su||ve===Mu,De=ee.getClearColor(),Oe=ee.getClearAlpha(),je=De.r,$e=De.g,Ue=De.b;Pe?(f[0]=je,f[1]=$e,f[2]=Ue,f[3]=Oe,G.clearBufferuiv(G.COLOR,0,f)):(_[0]=je,_[1]=$e,_[2]=Ue,_[3]=Oe,G.clearBufferiv(G.COLOR,0,_))}else oe|=G.COLOR_BUFFER_BIT}Z&&(oe|=G.DEPTH_BUFFER_BIT,G.clearDepth(this.capabilities.reverseDepthBuffer?0:1)),ie&&(oe|=G.STENCIL_BUFFER_BIT,this.state.buffers.stencil.setMask(4294967295)),G.clear(oe)},this.clearColor=function(){this.clear(!0,!1,!1)},this.clearDepth=function(){this.clear(!1,!0,!1)},this.clearStencil=function(){this.clear(!1,!1,!0)},this.dispose=function(){t.removeEventListener("webglcontextlost",W,!1),t.removeEventListener("webglcontextrestored",J,!1),t.removeEventListener("webglcontextcreationerror",ae,!1),Ae.dispose(),T.dispose(),He.dispose(),P.dispose(),ne.dispose(),de.dispose(),Y.dispose(),N.dispose(),Fe.dispose(),k.dispose(),k.removeEventListener("sessionstart",ti),k.removeEventListener("sessionend",Wn),Lt.stop()};function W(L){L.preventDefault(),console.log("THREE.WebGLRenderer: Context Lost."),M=!0}function J(){console.log("THREE.WebGLRenderer: Context Restored."),M=!1;const L=at.autoReset,Z=H.enabled,ie=H.autoUpdate,oe=H.needsUpdate,Q=H.type;B(),at.autoReset=L,H.enabled=Z,H.autoUpdate=ie,H.needsUpdate=oe,H.type=Q}function ae(L){console.error("THREE.WebGLRenderer: A WebGL context could not be created. Reason: ",L.statusMessage)}function pe(L){const Z=L.target;Z.removeEventListener("dispose",pe),xe(Z)}function xe(L){Le(L),He.remove(L)}function Le(L){const Z=He.get(L).programs;Z!==void 0&&(Z.forEach(function(ie){Fe.releaseProgram(ie)}),L.isShaderMaterial&&Fe.releaseShaderCache(L))}this.renderBufferDirect=function(L,Z,ie,oe,Q,ve){Z===null&&(Z=qe);const Pe=Q.isMesh&&Q.matrixWorld.determinant()<0,De=Ls(L,Z,ie,oe,Q);We.setMaterial(oe,Pe);let Oe=ie.index,je=1;if(oe.wireframe===!0){if(Oe=ge.getWireframeAttribute(ie),Oe===void 0)return;je=2}const $e=ie.drawRange,Ue=ie.attributes.position;let Qe=$e.start*je,nt=($e.start+$e.count)*je;ve!==null&&(Qe=Math.max(Qe,ve.start*je),nt=Math.min(nt,(ve.start+ve.count)*je)),Oe!==null?(Qe=Math.max(Qe,0),nt=Math.min(nt,Oe.count)):Ue!=null&&(Qe=Math.max(Qe,0),nt=Math.min(nt,Ue.count));const Et=nt-Qe;if(Et<0||Et===1/0)return;Y.setup(Q,oe,De,ie,Oe);let Xt,st=q;if(Oe!==null&&(Xt=fe.get(Oe),st=ce,st.setIndex(Xt)),Q.isMesh)oe.wireframe===!0?(We.setLineWidth(oe.wireframeLinewidth*Ge()),st.setMode(G.LINES)):st.setMode(G.TRIANGLES);else if(Q.isLine){let ke=oe.linewidth;ke===void 0&&(ke=1),We.setLineWidth(ke*Ge()),Q.isLineSegments?st.setMode(G.LINES):Q.isLineLoop?st.setMode(G.LINE_LOOP):st.setMode(G.LINE_STRIP)}else Q.isPoints?st.setMode(G.POINTS):Q.isSprite&&st.setMode(G.TRIANGLES);if(Q.isBatchedMesh)if(Q._multiDrawInstances!==null)st.renderMultiDrawInstances(Q._multiDrawStarts,Q._multiDrawCounts,Q._multiDrawCount,Q._multiDrawInstances);else if(et.get("WEBGL_multi_draw"))st.renderMultiDraw(Q._multiDrawStarts,Q._multiDrawCounts,Q._multiDrawCount);else{const ke=Q._multiDrawStarts,Pt=Q._multiDrawCounts,lt=Q._multiDrawCount,bn=Oe?fe.get(Oe).bytesPerElement:1,ni=He.get(oe).currentProgram.getUniforms();for(let sn=0;sn<lt;sn++)ni.setValue(G,"_gl_DrawID",sn),st.render(ke[sn]/bn,Pt[sn])}else if(Q.isInstancedMesh)st.renderInstances(Qe,Et,Q.count);else if(ie.isInstancedBufferGeometry){const ke=ie._maxInstanceCount!==void 0?ie._maxInstanceCount:1/0,Pt=Math.min(ie.instanceCount,ke);st.renderInstances(Qe,Et,Pt)}else st.render(Qe,Et)};function Re(L,Z,ie){L.transparent===!0&&L.side===en&&L.forceSinglePass===!1?(L.side=un,L.needsUpdate=!0,Tn(L,Z,ie),L.side=In,L.needsUpdate=!0,Tn(L,Z,ie),L.side=en):Tn(L,Z,ie)}this.compile=function(L,Z,ie=null){ie===null&&(ie=L),g=T.get(ie),g.init(Z),y.push(g),ie.traverseVisible(function(Q){Q.isLight&&Q.layers.test(Z.layers)&&(g.pushLight(Q),Q.castShadow&&g.pushShadow(Q))}),L!==ie&&L.traverseVisible(function(Q){Q.isLight&&Q.layers.test(Z.layers)&&(g.pushLight(Q),Q.castShadow&&g.pushShadow(Q))}),g.setupLights();const oe=new Set;return L.traverse(function(Q){if(!(Q.isMesh||Q.isPoints||Q.isLine||Q.isSprite))return;const ve=Q.material;if(ve)if(Array.isArray(ve))for(let Pe=0;Pe<ve.length;Pe++){const De=ve[Pe];Re(De,ie,Q),oe.add(De)}else Re(ve,ie,Q),oe.add(ve)}),y.pop(),g=null,oe},this.compileAsync=function(L,Z,ie=null){const oe=this.compile(L,Z,ie);return new Promise(Q=>{function ve(){if(oe.forEach(function(Pe){He.get(Pe).currentProgram.isReady()&&oe.delete(Pe)}),oe.size===0){Q(L);return}setTimeout(ve,10)}et.get("KHR_parallel_shader_compile")!==null?ve():setTimeout(ve,10)})};let Ye=null;function dn(L){Ye&&Ye(L)}function ti(){Lt.stop()}function Wn(){Lt.start()}const Lt=new pp;Lt.setAnimationLoop(dn),typeof self<"u"&&Lt.setContext(self),this.setAnimationLoop=function(L){Ye=L,k.setAnimationLoop(L),L===null?Lt.stop():Lt.start()},k.addEventListener("sessionstart",ti),k.addEventListener("sessionend",Wn),this.render=function(L,Z){if(Z!==void 0&&Z.isCamera!==!0){console.error("THREE.WebGLRenderer.render: camera is not an instance of THREE.Camera.");return}if(M===!0)return;if(L.matrixWorldAutoUpdate===!0&&L.updateMatrixWorld(),Z.parent===null&&Z.matrixWorldAutoUpdate===!0&&Z.updateMatrixWorld(),k.enabled===!0&&k.isPresenting===!0&&(k.cameraAutoUpdate===!0&&k.updateCamera(Z),Z=k.getCamera()),L.isScene===!0&&L.onBeforeRender(S,L,Z,C),g=T.get(L,y.length),g.init(Z),y.push(g),ye.multiplyMatrices(Z.projectionMatrix,Z.matrixWorldInverse),ze.setFromProjectionMatrix(ye),me=this.localClippingEnabled,ue=p.init(this.clippingPlanes,me),v=Ae.get(L,m.length),v.init(),m.push(v),k.enabled===!0&&k.isPresenting===!0){const ve=S.xr.getDepthSensingMesh();ve!==null&&sr(ve,Z,-1/0,S.sortObjects)}sr(L,Z,0,S.sortObjects),v.finish(),S.sortObjects===!0&&v.sort(j,Ee),Be=k.enabled===!1||k.isPresenting===!1||k.hasDepthSensing()===!1,Be&&ee.addToRenderList(v,L),this.info.render.frame++,ue===!0&&p.beginShadows();const ie=g.state.shadowsArray;H.render(ie,L,Z),ue===!0&&p.endShadows(),this.info.autoReset===!0&&this.info.reset();const oe=v.opaque,Q=v.transmissive;if(g.setupLights(),Z.isArrayCamera){const ve=Z.cameras;if(Q.length>0)for(let Pe=0,De=ve.length;Pe<De;Pe++){const Oe=ve[Pe];xn(oe,Q,L,Oe)}Be&&ee.render(L);for(let Pe=0,De=ve.length;Pe<De;Pe++){const Oe=ve[Pe];vo(v,L,Oe,Oe.viewport)}}else Q.length>0&&xn(oe,Q,L,Z),Be&&ee.render(L),vo(v,L,Z);C!==null&&(U.updateMultisampleRenderTarget(C),U.updateRenderTargetMipmap(C)),L.isScene===!0&&L.onAfterRender(S,L,Z),Y.resetDefaultState(),D=-1,$=null,y.pop(),y.length>0?(g=y[y.length-1],ue===!0&&p.setGlobalState(S.clippingPlanes,g.state.camera)):g=null,m.pop(),m.length>0?v=m[m.length-1]:v=null};function sr(L,Z,ie,oe){if(L.visible===!1)return;if(L.layers.test(Z.layers)){if(L.isGroup)ie=L.renderOrder;else if(L.isLOD)L.autoUpdate===!0&&L.update(Z);else if(L.isLight)g.pushLight(L),L.castShadow&&g.pushShadow(L);else if(L.isSprite){if(!L.frustumCulled||ze.intersectsSprite(L)){oe&&Ne.setFromMatrixPosition(L.matrixWorld).applyMatrix4(ye);const Pe=de.update(L),De=L.material;De.visible&&v.push(L,Pe,De,ie,Ne.z,null)}}else if((L.isMesh||L.isLine||L.isPoints)&&(!L.frustumCulled||ze.intersectsObject(L))){const Pe=de.update(L),De=L.material;if(oe&&(L.boundingSphere!==void 0?(L.boundingSphere===null&&L.computeBoundingSphere(),Ne.copy(L.boundingSphere.center)):(Pe.boundingSphere===null&&Pe.computeBoundingSphere(),Ne.copy(Pe.boundingSphere.center)),Ne.applyMatrix4(L.matrixWorld).applyMatrix4(ye)),Array.isArray(De)){const Oe=Pe.groups;for(let je=0,$e=Oe.length;je<$e;je++){const Ue=Oe[je],Qe=De[Ue.materialIndex];Qe&&Qe.visible&&v.push(L,Pe,Qe,ie,Ne.z,Ue)}}else De.visible&&v.push(L,Pe,De,ie,Ne.z,null)}}const ve=L.children;for(let Pe=0,De=ve.length;Pe<De;Pe++)sr(ve[Pe],Z,ie,oe)}function vo(L,Z,ie,oe){const Q=L.opaque,ve=L.transmissive,Pe=L.transparent;g.setupLightsView(ie),ue===!0&&p.setGlobalState(S.clippingPlanes,ie),oe&&We.viewport(b.copy(oe)),Q.length>0&&Ii(Q,Z,ie),ve.length>0&&Ii(ve,Z,ie),Pe.length>0&&Ii(Pe,Z,ie),We.buffers.depth.setTest(!0),We.buffers.depth.setMask(!0),We.buffers.color.setMask(!0),We.setPolygonOffset(!1)}function xn(L,Z,ie,oe){if((ie.isScene===!0?ie.overrideMaterial:null)!==null)return;g.state.transmissionRenderTarget[oe.id]===void 0&&(g.state.transmissionRenderTarget[oe.id]=new nr(1,1,{generateMipmaps:!0,type:et.has("EXT_color_buffer_half_float")||et.has("EXT_color_buffer_float")?mo:ci,minFilter:Ki,samples:4,stencilBuffer:s,resolveDepthBuffer:!1,resolveStencilBuffer:!1,colorSpace:ft.workingColorSpace}));const ve=g.state.transmissionRenderTarget[oe.id],Pe=oe.viewport||b;ve.setSize(Pe.z,Pe.w);const De=S.getRenderTarget();S.setRenderTarget(ve),S.getClearColor(O),X=S.getClearAlpha(),X<1&&S.setClearColor(16777215,.5),S.clear(),Be&&ee.render(ie);const Oe=S.toneMapping;S.toneMapping=tr;const je=oe.viewport;if(oe.viewport!==void 0&&(oe.viewport=void 0),g.setupLightsView(oe),ue===!0&&p.setGlobalState(S.clippingPlanes,oe),Ii(L,ie,oe),U.updateMultisampleRenderTarget(ve),U.updateRenderTargetMipmap(ve),et.has("WEBGL_multisampled_render_to_texture")===!1){let $e=!1;for(let Ue=0,Qe=Z.length;Ue<Qe;Ue++){const nt=Z[Ue],Et=nt.object,Xt=nt.geometry,st=nt.material,ke=nt.group;if(st.side===en&&Et.layers.test(oe.layers)){const Pt=st.side;st.side=un,st.needsUpdate=!0,Rs(Et,ie,oe,Xt,st,ke),st.side=Pt,st.needsUpdate=!0,$e=!0}}$e===!0&&(U.updateMultisampleRenderTarget(ve),U.updateRenderTargetMipmap(ve))}S.setRenderTarget(De),S.setClearColor(O,X),je!==void 0&&(oe.viewport=je),S.toneMapping=Oe}function Ii(L,Z,ie){const oe=Z.isScene===!0?Z.overrideMaterial:null;for(let Q=0,ve=L.length;Q<ve;Q++){const Pe=L[Q],De=Pe.object,Oe=Pe.geometry,je=oe===null?Pe.material:oe,$e=Pe.group;De.layers.test(ie.layers)&&Rs(De,Z,ie,Oe,je,$e)}}function Rs(L,Z,ie,oe,Q,ve){L.onBeforeRender(S,Z,ie,oe,Q,ve),L.modelViewMatrix.multiplyMatrices(ie.matrixWorldInverse,L.matrixWorld),L.normalMatrix.getNormalMatrix(L.modelViewMatrix),Q.onBeforeRender(S,Z,ie,oe,L,ve),Q.transparent===!0&&Q.side===en&&Q.forceSinglePass===!1?(Q.side=un,Q.needsUpdate=!0,S.renderBufferDirect(ie,Z,oe,Q,L,ve),Q.side=In,Q.needsUpdate=!0,S.renderBufferDirect(ie,Z,oe,Q,L,ve),Q.side=en):S.renderBufferDirect(ie,Z,oe,Q,L,ve),L.onAfterRender(S,Z,ie,oe,Q,ve)}function Tn(L,Z,ie){Z.isScene!==!0&&(Z=qe);const oe=He.get(L),Q=g.state.lights,ve=g.state.shadowsArray,Pe=Q.state.version,De=Fe.getParameters(L,Q.state,ve,Z,ie),Oe=Fe.getProgramCacheKey(De);let je=oe.programs;oe.environment=L.isMeshStandardMaterial?Z.environment:null,oe.fog=Z.fog,oe.envMap=(L.isMeshStandardMaterial?ne:P).get(L.envMap||oe.environment),oe.envMapRotation=oe.environment!==null&&L.envMap===null?Z.environmentRotation:L.envMapRotation,je===void 0&&(L.addEventListener("dispose",pe),je=new Map,oe.programs=je);let $e=je.get(Oe);if($e!==void 0){if(oe.currentProgram===$e&&oe.lightsStateVersion===Pe)return Cr(L,De),$e}else De.uniforms=Fe.getUniforms(L),L.onBeforeCompile(De,S),$e=Fe.acquireProgram(De,Oe),je.set(Oe,$e),oe.uniforms=De.uniforms;const Ue=oe.uniforms;return(!L.isShaderMaterial&&!L.isRawShaderMaterial||L.clipping===!0)&&(Ue.clippingPlanes=p.uniform),Cr(L,De),oe.needsLights=Pr(L),oe.lightsStateVersion=Pe,oe.needsLights&&(Ue.ambientLightColor.value=Q.state.ambient,Ue.lightProbe.value=Q.state.probe,Ue.directionalLights.value=Q.state.directional,Ue.directionalLightShadows.value=Q.state.directionalShadow,Ue.spotLights.value=Q.state.spot,Ue.spotLightShadows.value=Q.state.spotShadow,Ue.rectAreaLights.value=Q.state.rectArea,Ue.ltc_1.value=Q.state.rectAreaLTC1,Ue.ltc_2.value=Q.state.rectAreaLTC2,Ue.pointLights.value=Q.state.point,Ue.pointLightShadows.value=Q.state.pointShadow,Ue.hemisphereLights.value=Q.state.hemi,Ue.directionalShadowMap.value=Q.state.directionalShadowMap,Ue.directionalShadowMatrix.value=Q.state.directionalShadowMatrix,Ue.spotShadowMap.value=Q.state.spotShadowMap,Ue.spotLightMatrix.value=Q.state.spotLightMatrix,Ue.spotLightMap.value=Q.state.spotLightMap,Ue.pointShadowMap.value=Q.state.pointShadowMap,Ue.pointShadowMatrix.value=Q.state.pointShadowMatrix),oe.currentProgram=$e,oe.uniformsList=null,$e}function Ar(L){if(L.uniformsList===null){const Z=L.currentProgram.getUniforms();L.uniformsList=Ra.seqWithValue(Z.seq,L.uniforms)}return L.uniformsList}function Cr(L,Z){const ie=He.get(L);ie.outputColorSpace=Z.outputColorSpace,ie.batching=Z.batching,ie.batchingColor=Z.batchingColor,ie.instancing=Z.instancing,ie.instancingColor=Z.instancingColor,ie.instancingMorph=Z.instancingMorph,ie.skinning=Z.skinning,ie.morphTargets=Z.morphTargets,ie.morphNormals=Z.morphNormals,ie.morphColors=Z.morphColors,ie.morphTargetsCount=Z.morphTargetsCount,ie.numClippingPlanes=Z.numClippingPlanes,ie.numIntersection=Z.numClipIntersection,ie.vertexAlphas=Z.vertexAlphas,ie.vertexTangents=Z.vertexTangents,ie.toneMapping=Z.toneMapping}function Ls(L,Z,ie,oe,Q){Z.isScene!==!0&&(Z=qe),U.resetTextureUnits();const ve=Z.fog,Pe=oe.isMeshStandardMaterial?Z.environment:null,De=C===null?S.outputColorSpace:C.isXRRenderTarget===!0?C.texture.colorSpace:rr,Oe=(oe.isMeshStandardMaterial?ne:P).get(oe.envMap||Pe),je=oe.vertexColors===!0&&!!ie.attributes.color&&ie.attributes.color.itemSize===4,$e=!!ie.attributes.tangent&&(!!oe.normalMap||oe.anisotropy>0),Ue=!!ie.morphAttributes.position,Qe=!!ie.morphAttributes.normal,nt=!!ie.morphAttributes.color;let Et=tr;oe.toneMapped&&(C===null||C.isXRRenderTarget===!0)&&(Et=S.toneMapping);const Xt=ie.morphAttributes.position||ie.morphAttributes.normal||ie.morphAttributes.color,st=Xt!==void 0?Xt.length:0,ke=He.get(oe),Pt=g.state.lights;if(ue===!0&&(me===!0||L!==$)){const jt=L===$&&oe.id===D;p.setState(oe,L,jt)}let lt=!1;oe.version===ke.__version?(ke.needsLights&&ke.lightsStateVersion!==Pt.state.version||ke.outputColorSpace!==De||Q.isBatchedMesh&&ke.batching===!1||!Q.isBatchedMesh&&ke.batching===!0||Q.isBatchedMesh&&ke.batchingColor===!0&&Q.colorTexture===null||Q.isBatchedMesh&&ke.batchingColor===!1&&Q.colorTexture!==null||Q.isInstancedMesh&&ke.instancing===!1||!Q.isInstancedMesh&&ke.instancing===!0||Q.isSkinnedMesh&&ke.skinning===!1||!Q.isSkinnedMesh&&ke.skinning===!0||Q.isInstancedMesh&&ke.instancingColor===!0&&Q.instanceColor===null||Q.isInstancedMesh&&ke.instancingColor===!1&&Q.instanceColor!==null||Q.isInstancedMesh&&ke.instancingMorph===!0&&Q.morphTexture===null||Q.isInstancedMesh&&ke.instancingMorph===!1&&Q.morphTexture!==null||ke.envMap!==Oe||oe.fog===!0&&ke.fog!==ve||ke.numClippingPlanes!==void 0&&(ke.numClippingPlanes!==p.numPlanes||ke.numIntersection!==p.numIntersection)||ke.vertexAlphas!==je||ke.vertexTangents!==$e||ke.morphTargets!==Ue||ke.morphNormals!==Qe||ke.morphColors!==nt||ke.toneMapping!==Et||ke.morphTargetsCount!==st)&&(lt=!0):(lt=!0,ke.__version=oe.version);let bn=ke.currentProgram;lt===!0&&(bn=Tn(oe,Z,Q));let ni=!1,sn=!1,Rr=!1;const xt=bn.getUniforms(),$n=ke.uniforms;if(We.useProgram(bn.program)&&(ni=!0,sn=!0,Rr=!0),oe.id!==D&&(D=oe.id,sn=!0),ni||$!==L){Ze.reverseDepthBuffer?(we.copy(L.projectionMatrix),f0(we),p0(we),xt.setValue(G,"projectionMatrix",we)):xt.setValue(G,"projectionMatrix",L.projectionMatrix),xt.setValue(G,"viewMatrix",L.matrixWorldInverse);const jt=xt.map.cameraPosition;jt!==void 0&&jt.setValue(G,Ve.setFromMatrixPosition(L.matrixWorld)),Ze.logarithmicDepthBuffer&&xt.setValue(G,"logDepthBufFC",2/(Math.log(L.far+1)/Math.LN2)),(oe.isMeshPhongMaterial||oe.isMeshToonMaterial||oe.isMeshLambertMaterial||oe.isMeshBasicMaterial||oe.isMeshStandardMaterial||oe.isShaderMaterial)&&xt.setValue(G,"isOrthographic",L.isOrthographicCamera===!0),$!==L&&($=L,sn=!0,Rr=!0)}if(Q.isSkinnedMesh){xt.setOptional(G,Q,"bindMatrix"),xt.setOptional(G,Q,"bindMatrixInverse");const jt=Q.skeleton;jt&&(jt.boneTexture===null&&jt.computeBoneTexture(),xt.setValue(G,"boneTexture",jt.boneTexture,U))}Q.isBatchedMesh&&(xt.setOptional(G,Q,"batchingTexture"),xt.setValue(G,"batchingTexture",Q._matricesTexture,U),xt.setOptional(G,Q,"batchingIdTexture"),xt.setValue(G,"batchingIdTexture",Q._indirectTexture,U),xt.setOptional(G,Q,"batchingColorTexture"),Q._colorsTexture!==null&&xt.setValue(G,"batchingColorTexture",Q._colorsTexture,U));const Xn=ie.morphAttributes;if((Xn.position!==void 0||Xn.normal!==void 0||Xn.color!==void 0)&&te.update(Q,ie,bn),(sn||ke.receiveShadow!==Q.receiveShadow)&&(ke.receiveShadow=Q.receiveShadow,xt.setValue(G,"receiveShadow",Q.receiveShadow)),oe.isMeshGouraudMaterial&&oe.envMap!==null&&($n.envMap.value=Oe,$n.flipEnvMap.value=Oe.isCubeTexture&&Oe.isRenderTargetTexture===!1?-1:1),oe.isMeshStandardMaterial&&oe.envMap===null&&Z.environment!==null&&($n.envMapIntensity.value=Z.environmentIntensity),sn&&(xt.setValue(G,"toneMappingExposure",S.toneMappingExposure),ke.needsLights&&yo($n,Rr),ve&&oe.fog===!0&&be.refreshFogUniforms($n,ve),be.refreshMaterialUniforms($n,oe,he,K,g.state.transmissionRenderTarget[L.id]),Ra.upload(G,Ar(ke),$n,U)),oe.isShaderMaterial&&oe.uniformsNeedUpdate===!0&&(Ra.upload(G,Ar(ke),$n,U),oe.uniformsNeedUpdate=!1),oe.isSpriteMaterial&&xt.setValue(G,"center",Q.center),xt.setValue(G,"modelViewMatrix",Q.modelViewMatrix),xt.setValue(G,"normalMatrix",Q.normalMatrix),xt.setValue(G,"modelMatrix",Q.matrixWorld),oe.isShaderMaterial||oe.isRawShaderMaterial){const jt=oe.uniformsGroups;for(let Lr=0,Ot=jt.length;Lr<Ot;Lr++){const Bt=jt[Lr];N.update(Bt,bn),N.bind(Bt,bn)}}return bn}function yo(L,Z){L.ambientLightColor.needsUpdate=Z,L.lightProbe.needsUpdate=Z,L.directionalLights.needsUpdate=Z,L.directionalLightShadows.needsUpdate=Z,L.pointLights.needsUpdate=Z,L.pointLightShadows.needsUpdate=Z,L.spotLights.needsUpdate=Z,L.spotLightShadows.needsUpdate=Z,L.rectAreaLights.needsUpdate=Z,L.hemisphereLights.needsUpdate=Z}function Pr(L){return L.isMeshLambertMaterial||L.isMeshToonMaterial||L.isMeshPhongMaterial||L.isMeshStandardMaterial||L.isShadowMaterial||L.isShaderMaterial&&L.lights===!0}this.getActiveCubeFace=function(){return R},this.getActiveMipmapLevel=function(){return A},this.getRenderTarget=function(){return C},this.setRenderTargetTextures=function(L,Z,ie){He.get(L.texture).__webglTexture=Z,He.get(L.depthTexture).__webglTexture=ie;const oe=He.get(L);oe.__hasExternalTextures=!0,oe.__autoAllocateDepthBuffer=ie===void 0,oe.__autoAllocateDepthBuffer||et.has("WEBGL_multisampled_render_to_texture")===!0&&(console.warn("THREE.WebGLRenderer: Render-to-texture extension was disabled because an external texture was provided"),oe.__useRenderToTexture=!1)},this.setRenderTargetFramebuffer=function(L,Z){const ie=He.get(L);ie.__webglFramebuffer=Z,ie.__useDefaultFramebuffer=Z===void 0},this.setRenderTarget=function(L,Z=0,ie=0){C=L,R=Z,A=ie;let oe=!0,Q=null,ve=!1,Pe=!1;if(L){const Oe=He.get(L);if(Oe.__useDefaultFramebuffer!==void 0)We.bindFramebuffer(G.FRAMEBUFFER,null),oe=!1;else if(Oe.__webglFramebuffer===void 0)U.setupRenderTarget(L);else if(Oe.__hasExternalTextures)U.rebindTextures(L,He.get(L.texture).__webglTexture,He.get(L.depthTexture).__webglTexture);else if(L.depthBuffer){const Ue=L.depthTexture;if(Oe.__boundDepthTexture!==Ue){if(Ue!==null&&He.has(Ue)&&(L.width!==Ue.image.width||L.height!==Ue.image.height))throw new Error("WebGLRenderTarget: Attached DepthTexture is initialized to the incorrect size.");U.setupDepthRenderbuffer(L)}}const je=L.texture;(je.isData3DTexture||je.isDataArrayTexture||je.isCompressedArrayTexture)&&(Pe=!0);const $e=He.get(L).__webglFramebuffer;L.isWebGLCubeRenderTarget?(Array.isArray($e[Z])?Q=$e[Z][ie]:Q=$e[Z],ve=!0):L.samples>0&&U.useMultisampledRTT(L)===!1?Q=He.get(L).__webglMultisampledFramebuffer:Array.isArray($e)?Q=$e[ie]:Q=$e,b.copy(L.viewport),E.copy(L.scissor),F=L.scissorTest}else b.copy(_e).multiplyScalar(he).floor(),E.copy(Se).multiplyScalar(he).floor(),F=Me;if(We.bindFramebuffer(G.FRAMEBUFFER,Q)&&oe&&We.drawBuffers(L,Q),We.viewport(b),We.scissor(E),We.setScissorTest(F),ve){const Oe=He.get(L.texture);G.framebufferTexture2D(G.FRAMEBUFFER,G.COLOR_ATTACHMENT0,G.TEXTURE_CUBE_MAP_POSITIVE_X+Z,Oe.__webglTexture,ie)}else if(Pe){const Oe=He.get(L.texture),je=Z||0;G.framebufferTextureLayer(G.FRAMEBUFFER,G.COLOR_ATTACHMENT0,Oe.__webglTexture,ie||0,je)}D=-1},this.readRenderTargetPixels=function(L,Z,ie,oe,Q,ve,Pe){if(!(L&&L.isWebGLRenderTarget)){console.error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");return}let De=He.get(L).__webglFramebuffer;if(L.isWebGLCubeRenderTarget&&Pe!==void 0&&(De=De[Pe]),De){We.bindFramebuffer(G.FRAMEBUFFER,De);try{const Oe=L.texture,je=Oe.format,$e=Oe.type;if(!Ze.textureFormatReadable(je)){console.error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not in RGBA or implementation defined format.");return}if(!Ze.textureTypeReadable($e)){console.error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not in UnsignedByteType or implementation defined type.");return}Z>=0&&Z<=L.width-oe&&ie>=0&&ie<=L.height-Q&&G.readPixels(Z,ie,oe,Q,w.convert(je),w.convert($e),ve)}finally{const Oe=C!==null?He.get(C).__webglFramebuffer:null;We.bindFramebuffer(G.FRAMEBUFFER,Oe)}}},this.readRenderTargetPixelsAsync=async function(L,Z,ie,oe,Q,ve,Pe){if(!(L&&L.isWebGLRenderTarget))throw new Error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");let De=He.get(L).__webglFramebuffer;if(L.isWebGLCubeRenderTarget&&Pe!==void 0&&(De=De[Pe]),De){const Oe=L.texture,je=Oe.format,$e=Oe.type;if(!Ze.textureFormatReadable(je))throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in RGBA or implementation defined format.");if(!Ze.textureTypeReadable($e))throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in UnsignedByteType or implementation defined type.");if(Z>=0&&Z<=L.width-oe&&ie>=0&&ie<=L.height-Q){We.bindFramebuffer(G.FRAMEBUFFER,De);const Ue=G.createBuffer();G.bindBuffer(G.PIXEL_PACK_BUFFER,Ue),G.bufferData(G.PIXEL_PACK_BUFFER,ve.byteLength,G.STREAM_READ),G.readPixels(Z,ie,oe,Q,w.convert(je),w.convert($e),0);const Qe=C!==null?He.get(C).__webglFramebuffer:null;We.bindFramebuffer(G.FRAMEBUFFER,Qe);const nt=G.fenceSync(G.SYNC_GPU_COMMANDS_COMPLETE,0);return G.flush(),await h0(G,nt,4),G.bindBuffer(G.PIXEL_PACK_BUFFER,Ue),G.getBufferSubData(G.PIXEL_PACK_BUFFER,0,ve),G.deleteBuffer(Ue),G.deleteSync(nt),ve}else throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: requested read bounds are out of range.")}},this.copyFramebufferToTexture=function(L,Z=null,ie=0){L.isTexture!==!0&&(Pa("WebGLRenderer: copyFramebufferToTexture function signature has changed."),Z=arguments[0]||null,L=arguments[1]);const oe=Math.pow(2,-ie),Q=Math.floor(L.image.width*oe),ve=Math.floor(L.image.height*oe),Pe=Z!==null?Z.x:0,De=Z!==null?Z.y:0;U.setTexture2D(L,0),G.copyTexSubImage2D(G.TEXTURE_2D,ie,0,0,Pe,De,Q,ve),We.unbindTexture()},this.copyTextureToTexture=function(L,Z,ie=null,oe=null,Q=0){L.isTexture!==!0&&(Pa("WebGLRenderer: copyTextureToTexture function signature has changed."),oe=arguments[0]||null,L=arguments[1],Z=arguments[2],Q=arguments[3]||0,ie=null);let ve,Pe,De,Oe,je,$e;ie!==null?(ve=ie.max.x-ie.min.x,Pe=ie.max.y-ie.min.y,De=ie.min.x,Oe=ie.min.y):(ve=L.image.width,Pe=L.image.height,De=0,Oe=0),oe!==null?(je=oe.x,$e=oe.y):(je=0,$e=0);const Ue=w.convert(Z.format),Qe=w.convert(Z.type);U.setTexture2D(Z,0),G.pixelStorei(G.UNPACK_FLIP_Y_WEBGL,Z.flipY),G.pixelStorei(G.UNPACK_PREMULTIPLY_ALPHA_WEBGL,Z.premultiplyAlpha),G.pixelStorei(G.UNPACK_ALIGNMENT,Z.unpackAlignment);const nt=G.getParameter(G.UNPACK_ROW_LENGTH),Et=G.getParameter(G.UNPACK_IMAGE_HEIGHT),Xt=G.getParameter(G.UNPACK_SKIP_PIXELS),st=G.getParameter(G.UNPACK_SKIP_ROWS),ke=G.getParameter(G.UNPACK_SKIP_IMAGES),Pt=L.isCompressedTexture?L.mipmaps[Q]:L.image;G.pixelStorei(G.UNPACK_ROW_LENGTH,Pt.width),G.pixelStorei(G.UNPACK_IMAGE_HEIGHT,Pt.height),G.pixelStorei(G.UNPACK_SKIP_PIXELS,De),G.pixelStorei(G.UNPACK_SKIP_ROWS,Oe),L.isDataTexture?G.texSubImage2D(G.TEXTURE_2D,Q,je,$e,ve,Pe,Ue,Qe,Pt.data):L.isCompressedTexture?G.compressedTexSubImage2D(G.TEXTURE_2D,Q,je,$e,Pt.width,Pt.height,Ue,Pt.data):G.texSubImage2D(G.TEXTURE_2D,Q,je,$e,ve,Pe,Ue,Qe,Pt),G.pixelStorei(G.UNPACK_ROW_LENGTH,nt),G.pixelStorei(G.UNPACK_IMAGE_HEIGHT,Et),G.pixelStorei(G.UNPACK_SKIP_PIXELS,Xt),G.pixelStorei(G.UNPACK_SKIP_ROWS,st),G.pixelStorei(G.UNPACK_SKIP_IMAGES,ke),Q===0&&Z.generateMipmaps&&G.generateMipmap(G.TEXTURE_2D),We.unbindTexture()},this.copyTextureToTexture3D=function(L,Z,ie=null,oe=null,Q=0){L.isTexture!==!0&&(Pa("WebGLRenderer: copyTextureToTexture3D function signature has changed."),ie=arguments[0]||null,oe=arguments[1]||null,L=arguments[2],Z=arguments[3],Q=arguments[4]||0);let ve,Pe,De,Oe,je,$e,Ue,Qe,nt;const Et=L.isCompressedTexture?L.mipmaps[Q]:L.image;ie!==null?(ve=ie.max.x-ie.min.x,Pe=ie.max.y-ie.min.y,De=ie.max.z-ie.min.z,Oe=ie.min.x,je=ie.min.y,$e=ie.min.z):(ve=Et.width,Pe=Et.height,De=Et.depth,Oe=0,je=0,$e=0),oe!==null?(Ue=oe.x,Qe=oe.y,nt=oe.z):(Ue=0,Qe=0,nt=0);const Xt=w.convert(Z.format),st=w.convert(Z.type);let ke;if(Z.isData3DTexture)U.setTexture3D(Z,0),ke=G.TEXTURE_3D;else if(Z.isDataArrayTexture||Z.isCompressedArrayTexture)U.setTexture2DArray(Z,0),ke=G.TEXTURE_2D_ARRAY;else{console.warn("THREE.WebGLRenderer.copyTextureToTexture3D: only supports THREE.DataTexture3D and THREE.DataTexture2DArray.");return}G.pixelStorei(G.UNPACK_FLIP_Y_WEBGL,Z.flipY),G.pixelStorei(G.UNPACK_PREMULTIPLY_ALPHA_WEBGL,Z.premultiplyAlpha),G.pixelStorei(G.UNPACK_ALIGNMENT,Z.unpackAlignment);const Pt=G.getParameter(G.UNPACK_ROW_LENGTH),lt=G.getParameter(G.UNPACK_IMAGE_HEIGHT),bn=G.getParameter(G.UNPACK_SKIP_PIXELS),ni=G.getParameter(G.UNPACK_SKIP_ROWS),sn=G.getParameter(G.UNPACK_SKIP_IMAGES);G.pixelStorei(G.UNPACK_ROW_LENGTH,Et.width),G.pixelStorei(G.UNPACK_IMAGE_HEIGHT,Et.height),G.pixelStorei(G.UNPACK_SKIP_PIXELS,Oe),G.pixelStorei(G.UNPACK_SKIP_ROWS,je),G.pixelStorei(G.UNPACK_SKIP_IMAGES,$e),L.isDataTexture||L.isData3DTexture?G.texSubImage3D(ke,Q,Ue,Qe,nt,ve,Pe,De,Xt,st,Et.data):Z.isCompressedArrayTexture?G.compressedTexSubImage3D(ke,Q,Ue,Qe,nt,ve,Pe,De,Xt,Et.data):G.texSubImage3D(ke,Q,Ue,Qe,nt,ve,Pe,De,Xt,st,Et),G.pixelStorei(G.UNPACK_ROW_LENGTH,Pt),G.pixelStorei(G.UNPACK_IMAGE_HEIGHT,lt),G.pixelStorei(G.UNPACK_SKIP_PIXELS,bn),G.pixelStorei(G.UNPACK_SKIP_ROWS,ni),G.pixelStorei(G.UNPACK_SKIP_IMAGES,sn),Q===0&&Z.generateMipmaps&&G.generateMipmap(ke),We.unbindTexture()},this.initRenderTarget=function(L){He.get(L).__webglFramebuffer===void 0&&U.setupRenderTarget(L)},this.initTexture=function(L){L.isCubeTexture?U.setTextureCube(L,0):L.isData3DTexture?U.setTexture3D(L,0):L.isDataArrayTexture||L.isCompressedArrayTexture?U.setTexture2DArray(L,0):U.setTexture2D(L,0),We.unbindTexture()},this.resetState=function(){R=0,A=0,C=null,We.reset(),Y.reset()},typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}get coordinateSystem(){return Ci}get outputColorSpace(){return this._outputColorSpace}set outputColorSpace(e){this._outputColorSpace=e;const t=this.getContext();t.drawingBufferColorSpace=e===Au?"display-p3":"srgb",t.unpackColorSpace=ft.workingColorSpace===Wa?"display-p3":"srgb"}}class bp extends Jt{constructor(){super(),this.isScene=!0,this.type="Scene",this.background=null,this.environment=null,this.fog=null,this.backgroundBlurriness=0,this.backgroundIntensity=1,this.backgroundRotation=new ui,this.environmentIntensity=1,this.environmentRotation=new ui,this.overrideMaterial=null,typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}copy(e,t){return super.copy(e,t),e.background!==null&&(this.background=e.background.clone()),e.environment!==null&&(this.environment=e.environment.clone()),e.fog!==null&&(this.fog=e.fog.clone()),this.backgroundBlurriness=e.backgroundBlurriness,this.backgroundIntensity=e.backgroundIntensity,this.backgroundRotation.copy(e.backgroundRotation),this.environmentIntensity=e.environmentIntensity,this.environmentRotation.copy(e.environmentRotation),e.overrideMaterial!==null&&(this.overrideMaterial=e.overrideMaterial.clone()),this.matrixAutoUpdate=e.matrixAutoUpdate,this}toJSON(e){const t=super.toJSON(e);return this.fog!==null&&(t.object.fog=this.fog.toJSON()),this.backgroundBlurriness>0&&(t.object.backgroundBlurriness=this.backgroundBlurriness),this.backgroundIntensity!==1&&(t.object.backgroundIntensity=this.backgroundIntensity),t.object.backgroundRotation=this.backgroundRotation.toArray(),this.environmentIntensity!==1&&(t.object.environmentIntensity=this.environmentIntensity),t.object.environmentRotation=this.environmentRotation.toArray(),t}}class Gs extends pt{constructor(e,t,i,r=1){super(e,t,i),this.isInstancedBufferAttribute=!0,this.meshPerAttribute=r}copy(e){return super.copy(e),this.meshPerAttribute=e.meshPerAttribute,this}toJSON(){const e=super.toJSON();return e.meshPerAttribute=this.meshPerAttribute,e.isInstancedBufferAttribute=!0,e}}class Du extends Tr{constructor(e){super(),this.isLineBasicMaterial=!0,this.type="LineBasicMaterial",this.color=new Ke(16777215),this.map=null,this.linewidth=1,this.linecap="round",this.linejoin="round",this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.linewidth=e.linewidth,this.linecap=e.linecap,this.linejoin=e.linejoin,this.fog=e.fog,this}}const Oa=new z,Ba=new z,Eh=new ht,Ws=new Ri,Jo=new As,Wl=new z,Th=new z;class Eb extends Jt{constructor(e=new Ct,t=new Du){super(),this.isLine=!0,this.type="Line",this.geometry=e,this.material=t,this.updateMorphTargets()}copy(e,t){return super.copy(e,t),this.material=Array.isArray(e.material)?e.material.slice():e.material,this.geometry=e.geometry,this}computeLineDistances(){const e=this.geometry;if(e.index===null){const t=e.attributes.position,i=[0];for(let r=1,s=t.count;r<s;r++)Oa.fromBufferAttribute(t,r-1),Ba.fromBufferAttribute(t,r),i[r]=i[r-1],i[r]+=Oa.distanceTo(Ba);e.setAttribute("lineDistance",new Ft(i,1))}else console.warn("THREE.Line.computeLineDistances(): Computation only possible with non-indexed BufferGeometry.");return this}raycast(e,t){const i=this.geometry,r=this.matrixWorld,s=e.params.Line.threshold,o=i.drawRange;if(i.boundingSphere===null&&i.computeBoundingSphere(),Jo.copy(i.boundingSphere),Jo.applyMatrix4(r),Jo.radius+=s,e.ray.intersectsSphere(Jo)===!1)return;Eh.copy(r).invert(),Ws.copy(e.ray).applyMatrix4(Eh);const a=s/((this.scale.x+this.scale.y+this.scale.z)/3),l=a*a,c=this.isLineSegments?2:1,u=i.index,h=i.attributes.position;if(u!==null){const f=Math.max(0,o.start),_=Math.min(u.count,o.start+o.count);for(let v=f,g=_-1;v<g;v+=c){const m=u.getX(v),y=u.getX(v+1),S=Qo(this,e,Ws,l,m,y);S&&t.push(S)}if(this.isLineLoop){const v=u.getX(_-1),g=u.getX(f),m=Qo(this,e,Ws,l,v,g);m&&t.push(m)}}else{const f=Math.max(0,o.start),_=Math.min(h.count,o.start+o.count);for(let v=f,g=_-1;v<g;v+=c){const m=Qo(this,e,Ws,l,v,v+1);m&&t.push(m)}if(this.isLineLoop){const v=Qo(this,e,Ws,l,_-1,f);v&&t.push(v)}}}updateMorphTargets(){const t=this.geometry.morphAttributes,i=Object.keys(t);if(i.length>0){const r=t[i[0]];if(r!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let s=0,o=r.length;s<o;s++){const a=r[s].name||String(s);this.morphTargetInfluences.push(0),this.morphTargetDictionary[a]=s}}}}}function Qo(n,e,t,i,r,s){const o=n.geometry.attributes.position;if(Oa.fromBufferAttribute(o,r),Ba.fromBufferAttribute(o,s),t.distanceSqToSegment(Oa,Ba,Wl,Th)>i)return;Wl.applyMatrix4(n.matrixWorld);const l=e.ray.origin.distanceTo(Wl);if(!(l<e.near||l>e.far))return{distance:l,point:Th.clone().applyMatrix4(n.matrixWorld),index:r,face:null,faceIndex:null,barycoord:null,object:n}}const Ah=new z,Ch=new z;class Sp extends Eb{constructor(e,t){super(e,t),this.isLineSegments=!0,this.type="LineSegments"}computeLineDistances(){const e=this.geometry;if(e.index===null){const t=e.attributes.position,i=[];for(let r=0,s=t.count;r<s;r+=2)Ah.fromBufferAttribute(t,r),Ch.fromBufferAttribute(t,r+1),i[r]=r===0?0:i[r-1],i[r+1]=i[r]+Ah.distanceTo(Ch);e.setAttribute("lineDistance",new Ft(i,1))}else console.warn("THREE.LineSegments.computeLineDistances(): Computation only possible with non-indexed BufferGeometry.");return this}}class Nu extends Tr{constructor(e){super(),this.isPointsMaterial=!0,this.type="PointsMaterial",this.color=new Ke(16777215),this.map=null,this.alphaMap=null,this.size=1,this.sizeAttenuation=!0,this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.alphaMap=e.alphaMap,this.size=e.size,this.sizeAttenuation=e.sizeAttenuation,this.fog=e.fog,this}}const Ph=new ht,Qc=new Ri,ea=new As,ta=new z;class Mp extends Jt{constructor(e=new Ct,t=new Nu){super(),this.isPoints=!0,this.type="Points",this.geometry=e,this.material=t,this.updateMorphTargets()}copy(e,t){return super.copy(e,t),this.material=Array.isArray(e.material)?e.material.slice():e.material,this.geometry=e.geometry,this}raycast(e,t){const i=this.geometry,r=this.matrixWorld,s=e.params.Points.threshold,o=i.drawRange;if(i.boundingSphere===null&&i.computeBoundingSphere(),ea.copy(i.boundingSphere),ea.applyMatrix4(r),ea.radius+=s,e.ray.intersectsSphere(ea)===!1)return;Ph.copy(r).invert(),Qc.copy(e.ray).applyMatrix4(Ph);const a=s/((this.scale.x+this.scale.y+this.scale.z)/3),l=a*a,c=i.index,d=i.attributes.position;if(c!==null){const h=Math.max(0,o.start),f=Math.min(c.count,o.start+o.count);for(let _=h,v=f;_<v;_++){const g=c.getX(_);ta.fromBufferAttribute(d,g),Rh(ta,g,l,r,e,t,this)}}else{const h=Math.max(0,o.start),f=Math.min(d.count,o.start+o.count);for(let _=h,v=f;_<v;_++)ta.fromBufferAttribute(d,_),Rh(ta,_,l,r,e,t,this)}}updateMorphTargets(){const t=this.geometry.morphAttributes,i=Object.keys(t);if(i.length>0){const r=t[i[0]];if(r!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let s=0,o=r.length;s<o;s++){const a=r[s].name||String(s);this.morphTargetInfluences.push(0),this.morphTargetDictionary[a]=s}}}}}function Rh(n,e,t,i,r,s,o){const a=Qc.distanceSqToPoint(n);if(a<t){const l=new z;Qc.closestPointToPoint(n,l),l.applyMatrix4(i);const c=r.ray.origin.distanceTo(l);if(c<r.near||c>r.far)return;s.push({distance:c,distanceToRay:Math.sqrt(a),point:l,index:e,face:null,faceIndex:null,barycoord:null,object:o})}}class YE extends nn{constructor(e,t,i,r,s,o,a,l,c,u,d,h){super(null,o,a,l,c,u,r,s,d,h),this.isCompressedTexture=!0,this.image={width:t,height:i},this.mipmaps=e,this.flipY=!1,this.generateMipmaps=!1}}class ZE extends nn{constructor(e,t,i,r,s,o,a,l,c){super(e,t,i,r,s,o,a,l,c),this.isCanvasTexture=!0,this.needsUpdate=!0}}class Uu extends Ct{constructor(e=1,t=1,i=1,r=32,s=1,o=!1,a=0,l=Math.PI*2){super(),this.type="CylinderGeometry",this.parameters={radiusTop:e,radiusBottom:t,height:i,radialSegments:r,heightSegments:s,openEnded:o,thetaStart:a,thetaLength:l};const c=this;r=Math.floor(r),s=Math.floor(s);const u=[],d=[],h=[],f=[];let _=0;const v=[],g=i/2;let m=0;y(),o===!1&&(e>0&&S(!0),t>0&&S(!1)),this.setIndex(u),this.setAttribute("position",new Ft(d,3)),this.setAttribute("normal",new Ft(h,3)),this.setAttribute("uv",new Ft(f,2));function y(){const M=new z,R=new z;let A=0;const C=(t-e)/i;for(let D=0;D<=s;D++){const $=[],b=D/s,E=b*(t-e)+e;for(let F=0;F<=r;F++){const O=F/r,X=O*l+a,re=Math.sin(X),K=Math.cos(X);R.x=E*re,R.y=-b*i+g,R.z=E*K,d.push(R.x,R.y,R.z),M.set(re,C,K).normalize(),h.push(M.x,M.y,M.z),f.push(O,1-b),$.push(_++)}v.push($)}for(let D=0;D<r;D++)for(let $=0;$<s;$++){const b=v[$][D],E=v[$+1][D],F=v[$+1][D+1],O=v[$][D+1];e>0&&(u.push(b,E,O),A+=3),t>0&&(u.push(E,F,O),A+=3)}c.addGroup(m,A,0),m+=A}function S(M){const R=_,A=new Xe,C=new z;let D=0;const $=M===!0?e:t,b=M===!0?1:-1;for(let F=1;F<=r;F++)d.push(0,g*b,0),h.push(0,b,0),f.push(.5,.5),_++;const E=_;for(let F=0;F<=r;F++){const X=F/r*l+a,re=Math.cos(X),K=Math.sin(X);C.x=$*K,C.y=g*b,C.z=$*re,d.push(C.x,C.y,C.z),h.push(0,b,0),A.x=re*.5+.5,A.y=K*.5*b+.5,f.push(A.x,A.y),_++}for(let F=0;F<r;F++){const O=R+F,X=E+F;M===!0?u.push(X,X+1,O):u.push(X+1,X,O),D+=3}c.addGroup(m,D,M===!0?1:2),m+=D}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new Uu(e.radiusTop,e.radiusBottom,e.height,e.radialSegments,e.heightSegments,e.openEnded,e.thetaStart,e.thetaLength)}}class ja extends Ct{constructor(e=1,t=32,i=16,r=0,s=Math.PI*2,o=0,a=Math.PI){super(),this.type="SphereGeometry",this.parameters={radius:e,widthSegments:t,heightSegments:i,phiStart:r,phiLength:s,thetaStart:o,thetaLength:a},t=Math.max(3,Math.floor(t)),i=Math.max(2,Math.floor(i));const l=Math.min(o+a,Math.PI);let c=0;const u=[],d=new z,h=new z,f=[],_=[],v=[],g=[];for(let m=0;m<=i;m++){const y=[],S=m/i;let M=0;m===0&&o===0?M=.5/t:m===i&&l===Math.PI&&(M=-.5/t);for(let R=0;R<=t;R++){const A=R/t;d.x=-e*Math.cos(r+A*s)*Math.sin(o+S*a),d.y=e*Math.cos(o+S*a),d.z=e*Math.sin(r+A*s)*Math.sin(o+S*a),_.push(d.x,d.y,d.z),h.copy(d).normalize(),v.push(h.x,h.y,h.z),g.push(A+M,1-S),y.push(c++)}u.push(y)}for(let m=0;m<i;m++)for(let y=0;y<t;y++){const S=u[m][y+1],M=u[m][y],R=u[m+1][y],A=u[m+1][y+1];(m!==0||o>0)&&f.push(S,M,A),(m!==i-1||l<Math.PI)&&f.push(M,R,A)}this.setIndex(f),this.setAttribute("position",new Ft(_,3)),this.setAttribute("normal",new Ft(v,3)),this.setAttribute("uv",new Ft(g,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new ja(e.radius,e.widthSegments,e.heightSegments,e.phiStart,e.phiLength,e.thetaStart,e.thetaLength)}}class KE extends Tr{constructor(e){super(),this.isMeshStandardMaterial=!0,this.defines={STANDARD:""},this.type="MeshStandardMaterial",this.color=new Ke(16777215),this.roughness=1,this.metalness=0,this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.emissive=new Ke(0),this.emissiveIntensity=1,this.emissiveMap=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=ip,this.normalScale=new Xe(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.roughnessMap=null,this.metalnessMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new ui,this.envMapIntensity=1,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.flatShading=!1,this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.defines={STANDARD:""},this.color.copy(e.color),this.roughness=e.roughness,this.metalness=e.metalness,this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.emissive.copy(e.emissive),this.emissiveMap=e.emissiveMap,this.emissiveIntensity=e.emissiveIntensity,this.bumpMap=e.bumpMap,this.bumpScale=e.bumpScale,this.normalMap=e.normalMap,this.normalMapType=e.normalMapType,this.normalScale.copy(e.normalScale),this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.roughnessMap=e.roughnessMap,this.metalnessMap=e.metalnessMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapRotation.copy(e.envMapRotation),this.envMapIntensity=e.envMapIntensity,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.flatShading=e.flatShading,this.fog=e.fog,this}}const Lh={enabled:!1,files:{},add:function(n,e){this.enabled!==!1&&(this.files[n]=e)},get:function(n){if(this.enabled!==!1)return this.files[n]},remove:function(n){delete this.files[n]},clear:function(){this.files={}}};class Tb{constructor(e,t,i){const r=this;let s=!1,o=0,a=0,l;const c=[];this.onStart=void 0,this.onLoad=e,this.onProgress=t,this.onError=i,this.itemStart=function(u){a++,s===!1&&r.onStart!==void 0&&r.onStart(u,o,a),s=!0},this.itemEnd=function(u){o++,r.onProgress!==void 0&&r.onProgress(u,o,a),o===a&&(s=!1,r.onLoad!==void 0&&r.onLoad())},this.itemError=function(u){r.onError!==void 0&&r.onError(u)},this.resolveURL=function(u){return l?l(u):u},this.setURLModifier=function(u){return l=u,this},this.addHandler=function(u,d){return c.push(u,d),this},this.removeHandler=function(u){const d=c.indexOf(u);return d!==-1&&c.splice(d,2),this},this.getHandler=function(u){for(let d=0,h=c.length;d<h;d+=2){const f=c[d],_=c[d+1];if(f.global&&(f.lastIndex=0),f.test(u))return _}return null}}}const Ab=new Tb;class Fu{constructor(e){this.manager=e!==void 0?e:Ab,this.crossOrigin="anonymous",this.withCredentials=!1,this.path="",this.resourcePath="",this.requestHeader={}}load(){}loadAsync(e,t){const i=this;return new Promise(function(r,s){i.load(e,r,t,s)})}parse(){}setCrossOrigin(e){return this.crossOrigin=e,this}setWithCredentials(e){return this.withCredentials=e,this}setPath(e){return this.path=e,this}setResourcePath(e){return this.resourcePath=e,this}setRequestHeader(e){return this.requestHeader=e,this}}Fu.DEFAULT_MATERIAL_NAME="__DEFAULT";class Cb extends Fu{constructor(e){super(e)}load(e,t,i,r){this.path!==void 0&&(e=this.path+e),e=this.manager.resolveURL(e);const s=this,o=Lh.get(e);if(o!==void 0)return s.manager.itemStart(e),setTimeout(function(){t&&t(o),s.manager.itemEnd(e)},0),o;const a=ho("img");function l(){u(),Lh.add(e,this),t&&t(this),s.manager.itemEnd(e)}function c(d){u(),r&&r(d),s.manager.itemError(e),s.manager.itemEnd(e)}function u(){a.removeEventListener("load",l,!1),a.removeEventListener("error",c,!1)}return a.addEventListener("load",l,!1),a.addEventListener("error",c,!1),e.slice(0,5)!=="data:"&&this.crossOrigin!==void 0&&(a.crossOrigin=this.crossOrigin),s.manager.itemStart(e),a.src=e,a}}class na extends Fu{constructor(e){super(e)}load(e,t,i,r){const s=new nn,o=new Cb(this.manager);return o.setCrossOrigin(this.crossOrigin),o.setPath(this.path),o.load(e,function(a){s.image=a,s.needsUpdate=!0,t!==void 0&&t(s)},i,r),s}}class Pb extends Ct{constructor(){super(),this.isInstancedBufferGeometry=!0,this.type="InstancedBufferGeometry",this.instanceCount=1/0}copy(e){return super.copy(e),this.instanceCount=e.instanceCount,this}toJSON(){const e=super.toJSON();return e.instanceCount=this.instanceCount,e.isInstancedBufferGeometry=!0,e}}class Rb{constructor(e=!0){this.autoStart=e,this.startTime=0,this.oldTime=0,this.elapsedTime=0,this.running=!1}start(){this.startTime=Ih(),this.oldTime=this.startTime,this.elapsedTime=0,this.running=!0}stop(){this.getElapsedTime(),this.running=!1,this.autoStart=!1}getElapsedTime(){return this.getDelta(),this.elapsedTime}getDelta(){let e=0;if(this.autoStart&&!this.running)return this.start(),0;if(this.running){const t=Ih();e=(t-this.oldTime)/1e3,this.oldTime=t,this.elapsedTime+=e}return e}}function Ih(){return performance.now()}const Ou="\\[\\]\\.:\\/",Lb=new RegExp("["+Ou+"]","g"),Bu="[^"+Ou+"]",Ib="[^"+Ou.replace("\\.","")+"]",Db=/((?:WC+[\/:])*)/.source.replace("WC",Bu),Nb=/(WCOD+)?/.source.replace("WCOD",Ib),Ub=/(?:\.(WC+)(?:\[(.+)\])?)?/.source.replace("WC",Bu),Fb=/\.(WC+)(?:\[(.+)\])?/.source.replace("WC",Bu),Ob=new RegExp("^"+Db+Nb+Ub+Fb+"$"),Bb=["material","materials","bones","map"];class kb{constructor(e,t,i){const r=i||mt.parseTrackName(t);this._targetGroup=e,this._bindings=e.subscribe_(t,r)}getValue(e,t){this.bind();const i=this._targetGroup.nCachedObjects_,r=this._bindings[i];r!==void 0&&r.getValue(e,t)}setValue(e,t){const i=this._bindings;for(let r=this._targetGroup.nCachedObjects_,s=i.length;r!==s;++r)i[r].setValue(e,t)}bind(){const e=this._bindings;for(let t=this._targetGroup.nCachedObjects_,i=e.length;t!==i;++t)e[t].bind()}unbind(){const e=this._bindings;for(let t=this._targetGroup.nCachedObjects_,i=e.length;t!==i;++t)e[t].unbind()}}class mt{constructor(e,t,i){this.path=t,this.parsedPath=i||mt.parseTrackName(t),this.node=mt.findNode(e,this.parsedPath.nodeName),this.rootNode=e,this.getValue=this._getValue_unbound,this.setValue=this._setValue_unbound}static create(e,t,i){return e&&e.isAnimationObjectGroup?new mt.Composite(e,t,i):new mt(e,t,i)}static sanitizeNodeName(e){return e.replace(/\s/g,"_").replace(Lb,"")}static parseTrackName(e){const t=Ob.exec(e);if(t===null)throw new Error("PropertyBinding: Cannot parse trackName: "+e);const i={nodeName:t[2],objectName:t[3],objectIndex:t[4],propertyName:t[5],propertyIndex:t[6]},r=i.nodeName&&i.nodeName.lastIndexOf(".");if(r!==void 0&&r!==-1){const s=i.nodeName.substring(r+1);Bb.indexOf(s)!==-1&&(i.nodeName=i.nodeName.substring(0,r),i.objectName=s)}if(i.propertyName===null||i.propertyName.length===0)throw new Error("PropertyBinding: can not parse propertyName from trackName: "+e);return i}static findNode(e,t){if(t===void 0||t===""||t==="."||t===-1||t===e.name||t===e.uuid)return e;if(e.skeleton){const i=e.skeleton.getBoneByName(t);if(i!==void 0)return i}if(e.children){const i=function(s){for(let o=0;o<s.length;o++){const a=s[o];if(a.name===t||a.uuid===t)return a;const l=i(a.children);if(l)return l}return null},r=i(e.children);if(r)return r}return null}_getValue_unavailable(){}_setValue_unavailable(){}_getValue_direct(e,t){e[t]=this.targetObject[this.propertyName]}_getValue_array(e,t){const i=this.resolvedProperty;for(let r=0,s=i.length;r!==s;++r)e[t++]=i[r]}_getValue_arrayElement(e,t){e[t]=this.resolvedProperty[this.propertyIndex]}_getValue_toArray(e,t){this.resolvedProperty.toArray(e,t)}_setValue_direct(e,t){this.targetObject[this.propertyName]=e[t]}_setValue_direct_setNeedsUpdate(e,t){this.targetObject[this.propertyName]=e[t],this.targetObject.needsUpdate=!0}_setValue_direct_setMatrixWorldNeedsUpdate(e,t){this.targetObject[this.propertyName]=e[t],this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_array(e,t){const i=this.resolvedProperty;for(let r=0,s=i.length;r!==s;++r)i[r]=e[t++]}_setValue_array_setNeedsUpdate(e,t){const i=this.resolvedProperty;for(let r=0,s=i.length;r!==s;++r)i[r]=e[t++];this.targetObject.needsUpdate=!0}_setValue_array_setMatrixWorldNeedsUpdate(e,t){const i=this.resolvedProperty;for(let r=0,s=i.length;r!==s;++r)i[r]=e[t++];this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_arrayElement(e,t){this.resolvedProperty[this.propertyIndex]=e[t]}_setValue_arrayElement_setNeedsUpdate(e,t){this.resolvedProperty[this.propertyIndex]=e[t],this.targetObject.needsUpdate=!0}_setValue_arrayElement_setMatrixWorldNeedsUpdate(e,t){this.resolvedProperty[this.propertyIndex]=e[t],this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_fromArray(e,t){this.resolvedProperty.fromArray(e,t)}_setValue_fromArray_setNeedsUpdate(e,t){this.resolvedProperty.fromArray(e,t),this.targetObject.needsUpdate=!0}_setValue_fromArray_setMatrixWorldNeedsUpdate(e,t){this.resolvedProperty.fromArray(e,t),this.targetObject.matrixWorldNeedsUpdate=!0}_getValue_unbound(e,t){this.bind(),this.getValue(e,t)}_setValue_unbound(e,t){this.bind(),this.setValue(e,t)}bind(){let e=this.node;const t=this.parsedPath,i=t.objectName,r=t.propertyName;let s=t.propertyIndex;if(e||(e=mt.findNode(this.rootNode,t.nodeName),this.node=e),this.getValue=this._getValue_unavailable,this.setValue=this._setValue_unavailable,!e){console.warn("THREE.PropertyBinding: No target node found for track: "+this.path+".");return}if(i){let c=t.objectIndex;switch(i){case"materials":if(!e.material){console.error("THREE.PropertyBinding: Can not bind to material as node does not have a material.",this);return}if(!e.material.materials){console.error("THREE.PropertyBinding: Can not bind to material.materials as node.material does not have a materials array.",this);return}e=e.material.materials;break;case"bones":if(!e.skeleton){console.error("THREE.PropertyBinding: Can not bind to bones as node does not have a skeleton.",this);return}e=e.skeleton.bones;for(let u=0;u<e.length;u++)if(e[u].name===c){c=u;break}break;case"map":if("map"in e){e=e.map;break}if(!e.material){console.error("THREE.PropertyBinding: Can not bind to material as node does not have a material.",this);return}if(!e.material.map){console.error("THREE.PropertyBinding: Can not bind to material.map as node.material does not have a map.",this);return}e=e.material.map;break;default:if(e[i]===void 0){console.error("THREE.PropertyBinding: Can not bind to objectName of node undefined.",this);return}e=e[i]}if(c!==void 0){if(e[c]===void 0){console.error("THREE.PropertyBinding: Trying to bind to objectIndex of objectName, but is undefined.",this,e);return}e=e[c]}}const o=e[r];if(o===void 0){const c=t.nodeName;console.error("THREE.PropertyBinding: Trying to update property for track: "+c+"."+r+" but it wasn't found.",e);return}let a=this.Versioning.None;this.targetObject=e,e.needsUpdate!==void 0?a=this.Versioning.NeedsUpdate:e.matrixWorldNeedsUpdate!==void 0&&(a=this.Versioning.MatrixWorldNeedsUpdate);let l=this.BindingType.Direct;if(s!==void 0){if(r==="morphTargetInfluences"){if(!e.geometry){console.error("THREE.PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.",this);return}if(!e.geometry.morphAttributes){console.error("THREE.PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.morphAttributes.",this);return}e.morphTargetDictionary[s]!==void 0&&(s=e.morphTargetDictionary[s])}l=this.BindingType.ArrayElement,this.resolvedProperty=o,this.propertyIndex=s}else o.fromArray!==void 0&&o.toArray!==void 0?(l=this.BindingType.HasFromToArray,this.resolvedProperty=o):Array.isArray(o)?(l=this.BindingType.EntireArray,this.resolvedProperty=o):this.propertyName=r;this.getValue=this.GetterByBindingType[l],this.setValue=this.SetterByBindingTypeAndVersioning[l][a]}unbind(){this.node=null,this.getValue=this._getValue_unbound,this.setValue=this._setValue_unbound}}mt.Composite=kb;mt.prototype.BindingType={Direct:0,EntireArray:1,ArrayElement:2,HasFromToArray:3};mt.prototype.Versioning={None:0,NeedsUpdate:1,MatrixWorldNeedsUpdate:2};mt.prototype.GetterByBindingType=[mt.prototype._getValue_direct,mt.prototype._getValue_array,mt.prototype._getValue_arrayElement,mt.prototype._getValue_toArray];mt.prototype.SetterByBindingTypeAndVersioning=[[mt.prototype._setValue_direct,mt.prototype._setValue_direct_setNeedsUpdate,mt.prototype._setValue_direct_setMatrixWorldNeedsUpdate],[mt.prototype._setValue_array,mt.prototype._setValue_array_setNeedsUpdate,mt.prototype._setValue_array_setMatrixWorldNeedsUpdate],[mt.prototype._setValue_arrayElement,mt.prototype._setValue_arrayElement_setNeedsUpdate,mt.prototype._setValue_arrayElement_setMatrixWorldNeedsUpdate],[mt.prototype._setValue_fromArray,mt.prototype._setValue_fromArray_setNeedsUpdate,mt.prototype._setValue_fromArray_setMatrixWorldNeedsUpdate]];class wp{constructor(e){this.value=e}clone(){return new wp(this.value.clone===void 0?this.value:this.value.clone())}}const Dh=new ht;class zb{constructor(e,t,i=0,r=1/0){this.ray=new Ri(e,t),this.near=i,this.far=r,this.camera=null,this.layers=new Ru,this.params={Mesh:{},Line:{threshold:1},LOD:{},Points:{threshold:1},Sprite:{}}}set(e,t){this.ray.set(e,t)}setFromCamera(e,t){t.isPerspectiveCamera?(this.ray.origin.setFromMatrixPosition(t.matrixWorld),this.ray.direction.set(e.x,e.y,.5).unproject(t).sub(this.ray.origin).normalize(),this.camera=t):t.isOrthographicCamera?(this.ray.origin.set(e.x,e.y,(t.near+t.far)/(t.near-t.far)).unproject(t),this.ray.direction.set(0,0,-1).transformDirection(t.matrixWorld),this.camera=t):console.error("THREE.Raycaster: Unsupported camera type: "+t.type)}setFromXRController(e){return Dh.identity().extractRotation(e.matrixWorld),this.ray.origin.setFromMatrixPosition(e.matrixWorld),this.ray.direction.set(0,0,-1).applyMatrix4(Dh),this}intersectObject(e,t=!0,i=[]){return eu(e,this,i,t),i.sort(Nh),i}intersectObjects(e,t=!0,i=[]){for(let r=0,s=e.length;r<s;r++)eu(e[r],this,i,t);return i.sort(Nh),i}}function Nh(n,e){return n.distance-e.distance}function eu(n,e,t,i){let r=!0;if(n.layers.test(e.layers)&&n.raycast(e,t)===!1&&(r=!1),r===!0&&i===!0){const s=n.children;for(let o=0,a=s.length;o<a;o++)eu(s[o],e,t,!0)}}class Uh{constructor(e=1,t=0,i=0){return this.radius=e,this.phi=t,this.theta=i,this}set(e,t,i){return this.radius=e,this.phi=t,this.theta=i,this}copy(e){return this.radius=e.radius,this.phi=e.phi,this.theta=e.theta,this}makeSafe(){return this.phi=Math.max(1e-6,Math.min(Math.PI-1e-6,this.phi)),this}setFromVector3(e){return this.setFromCartesianCoords(e.x,e.y,e.z)}setFromCartesianCoords(e,t,i){return this.radius=Math.sqrt(e*e+t*t+i*i),this.radius===0?(this.theta=0,this.phi=0):(this.theta=Math.atan2(e,i),this.phi=Math.acos(Qt(t/this.radius,-1,1))),this}clone(){return new this.constructor().copy(this)}}const Fh=new z,ia=new z;class di{constructor(e=new z,t=new z){this.start=e,this.end=t}set(e,t){return this.start.copy(e),this.end.copy(t),this}copy(e){return this.start.copy(e.start),this.end.copy(e.end),this}getCenter(e){return e.addVectors(this.start,this.end).multiplyScalar(.5)}delta(e){return e.subVectors(this.end,this.start)}distanceSq(){return this.start.distanceToSquared(this.end)}distance(){return this.start.distanceTo(this.end)}at(e,t){return this.delta(t).multiplyScalar(e).add(this.start)}closestPointToPointParameter(e,t){Fh.subVectors(e,this.start),ia.subVectors(this.end,this.start);const i=ia.dot(ia);let s=ia.dot(Fh)/i;return t&&(s=Qt(s,0,1)),s}closestPointToPoint(e,t,i){const r=this.closestPointToPointParameter(e,t);return this.delta(i).multiplyScalar(r).add(this.start)}applyMatrix4(e){return this.start.applyMatrix4(e),this.end.applyMatrix4(e),this}equals(e){return e.start.equals(this.start)&&e.end.equals(this.end)}clone(){return new this.constructor().copy(this)}}class Hb extends Sp{constructor(e,t=16776960){const i=new Uint16Array([0,1,1,2,2,3,3,0,4,5,5,6,6,7,7,4,0,4,1,5,2,6,3,7]),r=[1,1,1,-1,1,1,-1,-1,1,1,-1,1,1,1,-1,-1,1,-1,-1,-1,-1,1,-1,-1],s=new Ct;s.setIndex(new pt(i,1)),s.setAttribute("position",new Ft(r,3)),super(s,new Du({color:t,toneMapped:!1})),this.box=e,this.type="Box3Helper",this.geometry.computeBoundingSphere()}updateMatrixWorld(e){const t=this.box;t.isEmpty()||(t.getCenter(this.position),t.getSize(this.scale),this.scale.multiplyScalar(.5),super.updateMatrixWorld(e))}dispose(){this.geometry.dispose(),this.material.dispose()}}class Vb extends Er{constructor(e,t=null){super(),this.object=e,this.domElement=t,this.enabled=!0,this.state=-1,this.keys={},this.mouseButtons={LEFT:null,MIDDLE:null,RIGHT:null},this.touches={ONE:null,TWO:null}}connect(){}disconnect(){}dispose(){}update(){}}typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("register",{detail:{revision:po}}));typeof window<"u"&&(window.__THREE__?console.warn("WARNING: Multiple instances of Three.js being imported."):window.__THREE__=po);const Oh={type:"change"},ku={type:"start"},Ep={type:"end"},ra=new Ri,Bh=new ri,Gb=Math.cos(70*Nt.DEG2RAD),zt=new z,Mn=2*Math.PI,gt={NONE:-1,ROTATE:0,DOLLY:1,PAN:2,TOUCH_ROTATE:3,TOUCH_PAN:4,TOUCH_DOLLY_PAN:5,TOUCH_DOLLY_ROTATE:6},$l=1e-6;class Wb extends Vb{constructor(e,t=null){super(e,t),this.state=gt.NONE,this.enabled=!0,this.target=new z,this.cursor=new z,this.minDistance=0,this.maxDistance=1/0,this.minZoom=0,this.maxZoom=1/0,this.minTargetRadius=0,this.maxTargetRadius=1/0,this.minPolarAngle=0,this.maxPolarAngle=Math.PI,this.minAzimuthAngle=-1/0,this.maxAzimuthAngle=1/0,this.enableDamping=!1,this.dampingFactor=.05,this.enableZoom=!0,this.zoomSpeed=1,this.enableRotate=!0,this.rotateSpeed=1,this.enablePan=!0,this.panSpeed=1,this.screenSpacePanning=!0,this.keyPanSpeed=7,this.zoomToCursor=!1,this.autoRotate=!1,this.autoRotateSpeed=2,this.keys={LEFT:"ArrowLeft",UP:"ArrowUp",RIGHT:"ArrowRight",BOTTOM:"ArrowDown"},this.mouseButtons={LEFT:ms.ROTATE,MIDDLE:ms.DOLLY,RIGHT:ms.PAN},this.touches={ONE:ds.ROTATE,TWO:ds.DOLLY_PAN},this.target0=this.target.clone(),this.position0=this.object.position.clone(),this.zoom0=this.object.zoom,this._domElementKeyEvents=null,this._lastPosition=new z,this._lastQuaternion=new wr,this._lastTargetPosition=new z,this._quat=new wr().setFromUnitVectors(e.up,new z(0,1,0)),this._quatInverse=this._quat.clone().invert(),this._spherical=new Uh,this._sphericalDelta=new Uh,this._scale=1,this._panOffset=new z,this._rotateStart=new Xe,this._rotateEnd=new Xe,this._rotateDelta=new Xe,this._panStart=new Xe,this._panEnd=new Xe,this._panDelta=new Xe,this._dollyStart=new Xe,this._dollyEnd=new Xe,this._dollyDelta=new Xe,this._dollyDirection=new z,this._mouse=new Xe,this._performCursorZoom=!1,this._pointers=[],this._pointerPositions={},this._controlActive=!1,this._onPointerMove=Xb.bind(this),this._onPointerDown=$b.bind(this),this._onPointerUp=jb.bind(this),this._onContextMenu=eS.bind(this),this._onMouseWheel=Zb.bind(this),this._onKeyDown=Kb.bind(this),this._onTouchStart=Jb.bind(this),this._onTouchMove=Qb.bind(this),this._onMouseDown=qb.bind(this),this._onMouseMove=Yb.bind(this),this._interceptControlDown=tS.bind(this),this._interceptControlUp=nS.bind(this),this.domElement!==null&&this.connect(),this.update()}connect(){this.domElement.addEventListener("pointerdown",this._onPointerDown),this.domElement.addEventListener("pointercancel",this._onPointerUp),this.domElement.addEventListener("contextmenu",this._onContextMenu),this.domElement.addEventListener("wheel",this._onMouseWheel,{passive:!1}),this.domElement.getRootNode().addEventListener("keydown",this._interceptControlDown,{passive:!0,capture:!0}),this.domElement.style.touchAction="none"}disconnect(){this.domElement.removeEventListener("pointerdown",this._onPointerDown),this.domElement.removeEventListener("pointermove",this._onPointerMove),this.domElement.removeEventListener("pointerup",this._onPointerUp),this.domElement.removeEventListener("pointercancel",this._onPointerUp),this.domElement.removeEventListener("wheel",this._onMouseWheel),this.domElement.removeEventListener("contextmenu",this._onContextMenu),this.stopListenToKeyEvents(),this.domElement.getRootNode().removeEventListener("keydown",this._interceptControlDown,{capture:!0}),this.domElement.style.touchAction="auto"}dispose(){this.disconnect()}getPolarAngle(){return this._spherical.phi}getAzimuthalAngle(){return this._spherical.theta}getDistance(){return this.object.position.distanceTo(this.target)}listenToKeyEvents(e){e.addEventListener("keydown",this._onKeyDown),this._domElementKeyEvents=e}stopListenToKeyEvents(){this._domElementKeyEvents!==null&&(this._domElementKeyEvents.removeEventListener("keydown",this._onKeyDown),this._domElementKeyEvents=null)}saveState(){this.target0.copy(this.target),this.position0.copy(this.object.position),this.zoom0=this.object.zoom}reset(){this.target.copy(this.target0),this.object.position.copy(this.position0),this.object.zoom=this.zoom0,this.object.updateProjectionMatrix(),this.dispatchEvent(Oh),this.update(),this.state=gt.NONE}update(e=null){const t=this.object.position;zt.copy(t).sub(this.target),zt.applyQuaternion(this._quat),this._spherical.setFromVector3(zt),this.autoRotate&&this.state===gt.NONE&&this._rotateLeft(this._getAutoRotationAngle(e)),this.enableDamping?(this._spherical.theta+=this._sphericalDelta.theta*this.dampingFactor,this._spherical.phi+=this._sphericalDelta.phi*this.dampingFactor):(this._spherical.theta+=this._sphericalDelta.theta,this._spherical.phi+=this._sphericalDelta.phi);let i=this.minAzimuthAngle,r=this.maxAzimuthAngle;isFinite(i)&&isFinite(r)&&(i<-Math.PI?i+=Mn:i>Math.PI&&(i-=Mn),r<-Math.PI?r+=Mn:r>Math.PI&&(r-=Mn),i<=r?this._spherical.theta=Math.max(i,Math.min(r,this._spherical.theta)):this._spherical.theta=this._spherical.theta>(i+r)/2?Math.max(i,this._spherical.theta):Math.min(r,this._spherical.theta)),this._spherical.phi=Math.max(this.minPolarAngle,Math.min(this.maxPolarAngle,this._spherical.phi)),this._spherical.makeSafe(),this.enableDamping===!0?this.target.addScaledVector(this._panOffset,this.dampingFactor):this.target.add(this._panOffset),this.target.sub(this.cursor),this.target.clampLength(this.minTargetRadius,this.maxTargetRadius),this.target.add(this.cursor);let s=!1;if(this.zoomToCursor&&this._performCursorZoom||this.object.isOrthographicCamera)this._spherical.radius=this._clampDistance(this._spherical.radius);else{const o=this._spherical.radius;this._spherical.radius=this._clampDistance(this._spherical.radius*this._scale),s=o!=this._spherical.radius}if(zt.setFromSpherical(this._spherical),zt.applyQuaternion(this._quatInverse),t.copy(this.target).add(zt),this.object.lookAt(this.target),this.enableDamping===!0?(this._sphericalDelta.theta*=1-this.dampingFactor,this._sphericalDelta.phi*=1-this.dampingFactor,this._panOffset.multiplyScalar(1-this.dampingFactor)):(this._sphericalDelta.set(0,0,0),this._panOffset.set(0,0,0)),this.zoomToCursor&&this._performCursorZoom){let o=null;if(this.object.isPerspectiveCamera){const a=zt.length();o=this._clampDistance(a*this._scale);const l=a-o;this.object.position.addScaledVector(this._dollyDirection,l),this.object.updateMatrixWorld(),s=!!l}else if(this.object.isOrthographicCamera){const a=new z(this._mouse.x,this._mouse.y,0);a.unproject(this.object);const l=this.object.zoom;this.object.zoom=Math.max(this.minZoom,Math.min(this.maxZoom,this.object.zoom/this._scale)),this.object.updateProjectionMatrix(),s=l!==this.object.zoom;const c=new z(this._mouse.x,this._mouse.y,0);c.unproject(this.object),this.object.position.sub(c).add(a),this.object.updateMatrixWorld(),o=zt.length()}else console.warn("WARNING: OrbitControls.js encountered an unknown camera type - zoom to cursor disabled."),this.zoomToCursor=!1;o!==null&&(this.screenSpacePanning?this.target.set(0,0,-1).transformDirection(this.object.matrix).multiplyScalar(o).add(this.object.position):(ra.origin.copy(this.object.position),ra.direction.set(0,0,-1).transformDirection(this.object.matrix),Math.abs(this.object.up.dot(ra.direction))<Gb?this.object.lookAt(this.target):(Bh.setFromNormalAndCoplanarPoint(this.object.up,this.target),ra.intersectPlane(Bh,this.target))))}else if(this.object.isOrthographicCamera){const o=this.object.zoom;this.object.zoom=Math.max(this.minZoom,Math.min(this.maxZoom,this.object.zoom/this._scale)),o!==this.object.zoom&&(this.object.updateProjectionMatrix(),s=!0)}return this._scale=1,this._performCursorZoom=!1,s||this._lastPosition.distanceToSquared(this.object.position)>$l||8*(1-this._lastQuaternion.dot(this.object.quaternion))>$l||this._lastTargetPosition.distanceToSquared(this.target)>$l?(this.dispatchEvent(Oh),this._lastPosition.copy(this.object.position),this._lastQuaternion.copy(this.object.quaternion),this._lastTargetPosition.copy(this.target),!0):!1}_getAutoRotationAngle(e){return e!==null?Mn/60*this.autoRotateSpeed*e:Mn/60/60*this.autoRotateSpeed}_getZoomScale(e){const t=Math.abs(e*.01);return Math.pow(.95,this.zoomSpeed*t)}_rotateLeft(e){this._sphericalDelta.theta-=e}_rotateUp(e){this._sphericalDelta.phi-=e}_panLeft(e,t){zt.setFromMatrixColumn(t,0),zt.multiplyScalar(-e),this._panOffset.add(zt)}_panUp(e,t){this.screenSpacePanning===!0?zt.setFromMatrixColumn(t,1):(zt.setFromMatrixColumn(t,0),zt.crossVectors(this.object.up,zt)),zt.multiplyScalar(e),this._panOffset.add(zt)}_pan(e,t){const i=this.domElement;if(this.object.isPerspectiveCamera){const r=this.object.position;zt.copy(r).sub(this.target);let s=zt.length();s*=Math.tan(this.object.fov/2*Math.PI/180),this._panLeft(2*e*s/i.clientHeight,this.object.matrix),this._panUp(2*t*s/i.clientHeight,this.object.matrix)}else this.object.isOrthographicCamera?(this._panLeft(e*(this.object.right-this.object.left)/this.object.zoom/i.clientWidth,this.object.matrix),this._panUp(t*(this.object.top-this.object.bottom)/this.object.zoom/i.clientHeight,this.object.matrix)):(console.warn("WARNING: OrbitControls.js encountered an unknown camera type - pan disabled."),this.enablePan=!1)}_dollyOut(e){this.object.isPerspectiveCamera||this.object.isOrthographicCamera?this._scale/=e:(console.warn("WARNING: OrbitControls.js encountered an unknown camera type - dolly/zoom disabled."),this.enableZoom=!1)}_dollyIn(e){this.object.isPerspectiveCamera||this.object.isOrthographicCamera?this._scale*=e:(console.warn("WARNING: OrbitControls.js encountered an unknown camera type - dolly/zoom disabled."),this.enableZoom=!1)}_updateZoomParameters(e,t){if(!this.zoomToCursor)return;this._performCursorZoom=!0;const i=this.domElement.getBoundingClientRect(),r=e-i.left,s=t-i.top,o=i.width,a=i.height;this._mouse.x=r/o*2-1,this._mouse.y=-(s/a)*2+1,this._dollyDirection.set(this._mouse.x,this._mouse.y,1).unproject(this.object).sub(this.object.position).normalize()}_clampDistance(e){return Math.max(this.minDistance,Math.min(this.maxDistance,e))}_handleMouseDownRotate(e){this._rotateStart.set(e.clientX,e.clientY)}_handleMouseDownDolly(e){this._updateZoomParameters(e.clientX,e.clientX),this._dollyStart.set(e.clientX,e.clientY)}_handleMouseDownPan(e){this._panStart.set(e.clientX,e.clientY)}_handleMouseMoveRotate(e){this._rotateEnd.set(e.clientX,e.clientY),this._rotateDelta.subVectors(this._rotateEnd,this._rotateStart).multiplyScalar(this.rotateSpeed);const t=this.domElement;this._rotateLeft(Mn*this._rotateDelta.x/t.clientHeight),this._rotateUp(Mn*this._rotateDelta.y/t.clientHeight),this._rotateStart.copy(this._rotateEnd),this.update()}_handleMouseMoveDolly(e){this._dollyEnd.set(e.clientX,e.clientY),this._dollyDelta.subVectors(this._dollyEnd,this._dollyStart),this._dollyDelta.y>0?this._dollyOut(this._getZoomScale(this._dollyDelta.y)):this._dollyDelta.y<0&&this._dollyIn(this._getZoomScale(this._dollyDelta.y)),this._dollyStart.copy(this._dollyEnd),this.update()}_handleMouseMovePan(e){this._panEnd.set(e.clientX,e.clientY),this._panDelta.subVectors(this._panEnd,this._panStart).multiplyScalar(this.panSpeed),this._pan(this._panDelta.x,this._panDelta.y),this._panStart.copy(this._panEnd),this.update()}_handleMouseWheel(e){this._updateZoomParameters(e.clientX,e.clientY),e.deltaY<0?this._dollyIn(this._getZoomScale(e.deltaY)):e.deltaY>0&&this._dollyOut(this._getZoomScale(e.deltaY)),this.update()}_handleKeyDown(e){let t=!1;switch(e.code){case this.keys.UP:e.ctrlKey||e.metaKey||e.shiftKey?this._rotateUp(Mn*this.rotateSpeed/this.domElement.clientHeight):this._pan(0,this.keyPanSpeed),t=!0;break;case this.keys.BOTTOM:e.ctrlKey||e.metaKey||e.shiftKey?this._rotateUp(-Mn*this.rotateSpeed/this.domElement.clientHeight):this._pan(0,-this.keyPanSpeed),t=!0;break;case this.keys.LEFT:e.ctrlKey||e.metaKey||e.shiftKey?this._rotateLeft(Mn*this.rotateSpeed/this.domElement.clientHeight):this._pan(this.keyPanSpeed,0),t=!0;break;case this.keys.RIGHT:e.ctrlKey||e.metaKey||e.shiftKey?this._rotateLeft(-Mn*this.rotateSpeed/this.domElement.clientHeight):this._pan(-this.keyPanSpeed,0),t=!0;break}t&&(e.preventDefault(),this.update())}_handleTouchStartRotate(e){if(this._pointers.length===1)this._rotateStart.set(e.pageX,e.pageY);else{const t=this._getSecondPointerPosition(e),i=.5*(e.pageX+t.x),r=.5*(e.pageY+t.y);this._rotateStart.set(i,r)}}_handleTouchStartPan(e){if(this._pointers.length===1)this._panStart.set(e.pageX,e.pageY);else{const t=this._getSecondPointerPosition(e),i=.5*(e.pageX+t.x),r=.5*(e.pageY+t.y);this._panStart.set(i,r)}}_handleTouchStartDolly(e){const t=this._getSecondPointerPosition(e),i=e.pageX-t.x,r=e.pageY-t.y,s=Math.sqrt(i*i+r*r);this._dollyStart.set(0,s)}_handleTouchStartDollyPan(e){this.enableZoom&&this._handleTouchStartDolly(e),this.enablePan&&this._handleTouchStartPan(e)}_handleTouchStartDollyRotate(e){this.enableZoom&&this._handleTouchStartDolly(e),this.enableRotate&&this._handleTouchStartRotate(e)}_handleTouchMoveRotate(e){if(this._pointers.length==1)this._rotateEnd.set(e.pageX,e.pageY);else{const i=this._getSecondPointerPosition(e),r=.5*(e.pageX+i.x),s=.5*(e.pageY+i.y);this._rotateEnd.set(r,s)}this._rotateDelta.subVectors(this._rotateEnd,this._rotateStart).multiplyScalar(this.rotateSpeed);const t=this.domElement;this._rotateLeft(Mn*this._rotateDelta.x/t.clientHeight),this._rotateUp(Mn*this._rotateDelta.y/t.clientHeight),this._rotateStart.copy(this._rotateEnd)}_handleTouchMovePan(e){if(this._pointers.length===1)this._panEnd.set(e.pageX,e.pageY);else{const t=this._getSecondPointerPosition(e),i=.5*(e.pageX+t.x),r=.5*(e.pageY+t.y);this._panEnd.set(i,r)}this._panDelta.subVectors(this._panEnd,this._panStart).multiplyScalar(this.panSpeed),this._pan(this._panDelta.x,this._panDelta.y),this._panStart.copy(this._panEnd)}_handleTouchMoveDolly(e){const t=this._getSecondPointerPosition(e),i=e.pageX-t.x,r=e.pageY-t.y,s=Math.sqrt(i*i+r*r);this._dollyEnd.set(0,s),this._dollyDelta.set(0,Math.pow(this._dollyEnd.y/this._dollyStart.y,this.zoomSpeed)),this._dollyOut(this._dollyDelta.y),this._dollyStart.copy(this._dollyEnd);const o=(e.pageX+t.x)*.5,a=(e.pageY+t.y)*.5;this._updateZoomParameters(o,a)}_handleTouchMoveDollyPan(e){this.enableZoom&&this._handleTouchMoveDolly(e),this.enablePan&&this._handleTouchMovePan(e)}_handleTouchMoveDollyRotate(e){this.enableZoom&&this._handleTouchMoveDolly(e),this.enableRotate&&this._handleTouchMoveRotate(e)}_addPointer(e){this._pointers.push(e.pointerId)}_removePointer(e){delete this._pointerPositions[e.pointerId];for(let t=0;t<this._pointers.length;t++)if(this._pointers[t]==e.pointerId){this._pointers.splice(t,1);return}}_isTrackingPointer(e){for(let t=0;t<this._pointers.length;t++)if(this._pointers[t]==e.pointerId)return!0;return!1}_trackPointer(e){let t=this._pointerPositions[e.pointerId];t===void 0&&(t=new Xe,this._pointerPositions[e.pointerId]=t),t.set(e.pageX,e.pageY)}_getSecondPointerPosition(e){const t=e.pointerId===this._pointers[0]?this._pointers[1]:this._pointers[0];return this._pointerPositions[t]}_customWheelEvent(e){const t=e.deltaMode,i={clientX:e.clientX,clientY:e.clientY,deltaY:e.deltaY};switch(t){case 1:i.deltaY*=16;break;case 2:i.deltaY*=100;break}return e.ctrlKey&&!this._controlActive&&(i.deltaY*=10),i}}function $b(n){this.enabled!==!1&&(this._pointers.length===0&&(this.domElement.setPointerCapture(n.pointerId),this.domElement.addEventListener("pointermove",this._onPointerMove),this.domElement.addEventListener("pointerup",this._onPointerUp)),!this._isTrackingPointer(n)&&(this._addPointer(n),n.pointerType==="touch"?this._onTouchStart(n):this._onMouseDown(n)))}function Xb(n){this.enabled!==!1&&(n.pointerType==="touch"?this._onTouchMove(n):this._onMouseMove(n))}function jb(n){switch(this._removePointer(n),this._pointers.length){case 0:this.domElement.releasePointerCapture(n.pointerId),this.domElement.removeEventListener("pointermove",this._onPointerMove),this.domElement.removeEventListener("pointerup",this._onPointerUp),this.dispatchEvent(Ep),this.state=gt.NONE;break;case 1:const e=this._pointers[0],t=this._pointerPositions[e];this._onTouchStart({pointerId:e,pageX:t.x,pageY:t.y});break}}function qb(n){let e;switch(n.button){case 0:e=this.mouseButtons.LEFT;break;case 1:e=this.mouseButtons.MIDDLE;break;case 2:e=this.mouseButtons.RIGHT;break;default:e=-1}switch(e){case ms.DOLLY:if(this.enableZoom===!1)return;this._handleMouseDownDolly(n),this.state=gt.DOLLY;break;case ms.ROTATE:if(n.ctrlKey||n.metaKey||n.shiftKey){if(this.enablePan===!1)return;this._handleMouseDownPan(n),this.state=gt.PAN}else{if(this.enableRotate===!1)return;this._handleMouseDownRotate(n),this.state=gt.ROTATE}break;case ms.PAN:if(n.ctrlKey||n.metaKey||n.shiftKey){if(this.enableRotate===!1)return;this._handleMouseDownRotate(n),this.state=gt.ROTATE}else{if(this.enablePan===!1)return;this._handleMouseDownPan(n),this.state=gt.PAN}break;default:this.state=gt.NONE}this.state!==gt.NONE&&this.dispatchEvent(ku)}function Yb(n){switch(this.state){case gt.ROTATE:if(this.enableRotate===!1)return;this._handleMouseMoveRotate(n);break;case gt.DOLLY:if(this.enableZoom===!1)return;this._handleMouseMoveDolly(n);break;case gt.PAN:if(this.enablePan===!1)return;this._handleMouseMovePan(n);break}}function Zb(n){this.enabled===!1||this.enableZoom===!1||this.state!==gt.NONE||(n.preventDefault(),this.dispatchEvent(ku),this._handleMouseWheel(this._customWheelEvent(n)),this.dispatchEvent(Ep))}function Kb(n){this.enabled===!1||this.enablePan===!1||this._handleKeyDown(n)}function Jb(n){switch(this._trackPointer(n),this._pointers.length){case 1:switch(this.touches.ONE){case ds.ROTATE:if(this.enableRotate===!1)return;this._handleTouchStartRotate(n),this.state=gt.TOUCH_ROTATE;break;case ds.PAN:if(this.enablePan===!1)return;this._handleTouchStartPan(n),this.state=gt.TOUCH_PAN;break;default:this.state=gt.NONE}break;case 2:switch(this.touches.TWO){case ds.DOLLY_PAN:if(this.enableZoom===!1&&this.enablePan===!1)return;this._handleTouchStartDollyPan(n),this.state=gt.TOUCH_DOLLY_PAN;break;case ds.DOLLY_ROTATE:if(this.enableZoom===!1&&this.enableRotate===!1)return;this._handleTouchStartDollyRotate(n),this.state=gt.TOUCH_DOLLY_ROTATE;break;default:this.state=gt.NONE}break;default:this.state=gt.NONE}this.state!==gt.NONE&&this.dispatchEvent(ku)}function Qb(n){switch(this._trackPointer(n),this.state){case gt.TOUCH_ROTATE:if(this.enableRotate===!1)return;this._handleTouchMoveRotate(n),this.update();break;case gt.TOUCH_PAN:if(this.enablePan===!1)return;this._handleTouchMovePan(n),this.update();break;case gt.TOUCH_DOLLY_PAN:if(this.enableZoom===!1&&this.enablePan===!1)return;this._handleTouchMoveDollyPan(n),this.update();break;case gt.TOUCH_DOLLY_ROTATE:if(this.enableZoom===!1&&this.enableRotate===!1)return;this._handleTouchMoveDollyRotate(n),this.update();break;default:this.state=gt.NONE}}function eS(n){this.enabled!==!1&&n.preventDefault()}function tS(n){n.key==="Control"&&(this._controlActive=!0,this.domElement.getRootNode().addEventListener("keyup",this._interceptControlUp,{passive:!0,capture:!0}))}function nS(n){n.key==="Control"&&(this._controlActive=!1,this.domElement.getRootNode().removeEventListener("keyup",this._interceptControlUp,{passive:!0,capture:!0}))}/**
 * lil-gui
 * https://lil-gui.georgealways.com
 * @version 0.19.2
 * @author George Michael Brower
 * @license MIT
 */class li{constructor(e,t,i,r,s="div"){this.parent=e,this.object=t,this.property=i,this._disabled=!1,this._hidden=!1,this.initialValue=this.getValue(),this.domElement=document.createElement(s),this.domElement.classList.add("controller"),this.domElement.classList.add(r),this.$name=document.createElement("div"),this.$name.classList.add("name"),li.nextNameID=li.nextNameID||0,this.$name.id=`lil-gui-name-${++li.nextNameID}`,this.$widget=document.createElement("div"),this.$widget.classList.add("widget"),this.$disable=this.$widget,this.domElement.appendChild(this.$name),this.domElement.appendChild(this.$widget),this.domElement.addEventListener("keydown",o=>o.stopPropagation()),this.domElement.addEventListener("keyup",o=>o.stopPropagation()),this.parent.children.push(this),this.parent.controllers.push(this),this.parent.$children.appendChild(this.domElement),this._listenCallback=this._listenCallback.bind(this),this.name(i)}name(e){return this._name=e,this.$name.textContent=e,this}onChange(e){return this._onChange=e,this}_callOnChange(){this.parent._callOnChange(this),this._onChange!==void 0&&this._onChange.call(this,this.getValue()),this._changed=!0}onFinishChange(e){return this._onFinishChange=e,this}_callOnFinishChange(){this._changed&&(this.parent._callOnFinishChange(this),this._onFinishChange!==void 0&&this._onFinishChange.call(this,this.getValue())),this._changed=!1}reset(){return this.setValue(this.initialValue),this._callOnFinishChange(),this}enable(e=!0){return this.disable(!e)}disable(e=!0){return e===this._disabled?this:(this._disabled=e,this.domElement.classList.toggle("disabled",e),this.$disable.toggleAttribute("disabled",e),this)}show(e=!0){return this._hidden=!e,this.domElement.style.display=this._hidden?"none":"",this}hide(){return this.show(!1)}options(e){const t=this.parent.add(this.object,this.property,e);return t.name(this._name),this.destroy(),t}min(e){return this}max(e){return this}step(e){return this}decimals(e){return this}listen(e=!0){return this._listening=e,this._listenCallbackID!==void 0&&(cancelAnimationFrame(this._listenCallbackID),this._listenCallbackID=void 0),this._listening&&this._listenCallback(),this}_listenCallback(){this._listenCallbackID=requestAnimationFrame(this._listenCallback);const e=this.save();e!==this._listenPrevValue&&this.updateDisplay(),this._listenPrevValue=e}getValue(){return this.object[this.property]}setValue(e){return this.getValue()!==e&&(this.object[this.property]=e,this._callOnChange(),this.updateDisplay()),this}updateDisplay(){return this}load(e){return this.setValue(e),this._callOnFinishChange(),this}save(){return this.getValue()}destroy(){this.listen(!1),this.parent.children.splice(this.parent.children.indexOf(this),1),this.parent.controllers.splice(this.parent.controllers.indexOf(this),1),this.parent.$children.removeChild(this.domElement)}}class iS extends li{constructor(e,t,i){super(e,t,i,"boolean","label"),this.$input=document.createElement("input"),this.$input.setAttribute("type","checkbox"),this.$input.setAttribute("aria-labelledby",this.$name.id),this.$widget.appendChild(this.$input),this.$input.addEventListener("change",()=>{this.setValue(this.$input.checked),this._callOnFinishChange()}),this.$disable=this.$input,this.updateDisplay()}updateDisplay(){return this.$input.checked=this.getValue(),this}}function tu(n){let e,t;return(e=n.match(/(#|0x)?([a-f0-9]{6})/i))?t=e[2]:(e=n.match(/rgb\(\s*(\d*)\s*,\s*(\d*)\s*,\s*(\d*)\s*\)/))?t=parseInt(e[1]).toString(16).padStart(2,0)+parseInt(e[2]).toString(16).padStart(2,0)+parseInt(e[3]).toString(16).padStart(2,0):(e=n.match(/^#?([a-f0-9])([a-f0-9])([a-f0-9])$/i))&&(t=e[1]+e[1]+e[2]+e[2]+e[3]+e[3]),t?"#"+t:!1}const rS={isPrimitive:!0,match:n=>typeof n=="string",fromHexString:tu,toHexString:tu},fo={isPrimitive:!0,match:n=>typeof n=="number",fromHexString:n=>parseInt(n.substring(1),16),toHexString:n=>"#"+n.toString(16).padStart(6,0)},sS={isPrimitive:!1,match:n=>Array.isArray(n),fromHexString(n,e,t=1){const i=fo.fromHexString(n);e[0]=(i>>16&255)/255*t,e[1]=(i>>8&255)/255*t,e[2]=(i&255)/255*t},toHexString([n,e,t],i=1){i=255/i;const r=n*i<<16^e*i<<8^t*i<<0;return fo.toHexString(r)}},oS={isPrimitive:!1,match:n=>Object(n)===n,fromHexString(n,e,t=1){const i=fo.fromHexString(n);e.r=(i>>16&255)/255*t,e.g=(i>>8&255)/255*t,e.b=(i&255)/255*t},toHexString({r:n,g:e,b:t},i=1){i=255/i;const r=n*i<<16^e*i<<8^t*i<<0;return fo.toHexString(r)}},aS=[rS,fo,sS,oS];function lS(n){return aS.find(e=>e.match(n))}class cS extends li{constructor(e,t,i,r){super(e,t,i,"color"),this.$input=document.createElement("input"),this.$input.setAttribute("type","color"),this.$input.setAttribute("tabindex",-1),this.$input.setAttribute("aria-labelledby",this.$name.id),this.$text=document.createElement("input"),this.$text.setAttribute("type","text"),this.$text.setAttribute("spellcheck","false"),this.$text.setAttribute("aria-labelledby",this.$name.id),this.$display=document.createElement("div"),this.$display.classList.add("display"),this.$display.appendChild(this.$input),this.$widget.appendChild(this.$display),this.$widget.appendChild(this.$text),this._format=lS(this.initialValue),this._rgbScale=r,this._initialValueHexString=this.save(),this._textFocused=!1,this.$input.addEventListener("input",()=>{this._setValueFromHexString(this.$input.value)}),this.$input.addEventListener("blur",()=>{this._callOnFinishChange()}),this.$text.addEventListener("input",()=>{const s=tu(this.$text.value);s&&this._setValueFromHexString(s)}),this.$text.addEventListener("focus",()=>{this._textFocused=!0,this.$text.select()}),this.$text.addEventListener("blur",()=>{this._textFocused=!1,this.updateDisplay(),this._callOnFinishChange()}),this.$disable=this.$text,this.updateDisplay()}reset(){return this._setValueFromHexString(this._initialValueHexString),this}_setValueFromHexString(e){if(this._format.isPrimitive){const t=this._format.fromHexString(e);this.setValue(t)}else this._format.fromHexString(e,this.getValue(),this._rgbScale),this._callOnChange(),this.updateDisplay()}save(){return this._format.toHexString(this.getValue(),this._rgbScale)}load(e){return this._setValueFromHexString(e),this._callOnFinishChange(),this}updateDisplay(){return this.$input.value=this._format.toHexString(this.getValue(),this._rgbScale),this._textFocused||(this.$text.value=this.$input.value.substring(1)),this.$display.style.backgroundColor=this.$input.value,this}}class Xl extends li{constructor(e,t,i){super(e,t,i,"function"),this.$button=document.createElement("button"),this.$button.appendChild(this.$name),this.$widget.appendChild(this.$button),this.$button.addEventListener("click",r=>{r.preventDefault(),this.getValue().call(this.object),this._callOnChange()}),this.$button.addEventListener("touchstart",()=>{},{passive:!0}),this.$disable=this.$button}}class uS extends li{constructor(e,t,i,r,s,o){super(e,t,i,"number"),this._initInput(),this.min(r),this.max(s);const a=o!==void 0;this.step(a?o:this._getImplicitStep(),a),this.updateDisplay()}decimals(e){return this._decimals=e,this.updateDisplay(),this}min(e){return this._min=e,this._onUpdateMinMax(),this}max(e){return this._max=e,this._onUpdateMinMax(),this}step(e,t=!0){return this._step=e,this._stepExplicit=t,this}updateDisplay(){const e=this.getValue();if(this._hasSlider){let t=(e-this._min)/(this._max-this._min);t=Math.max(0,Math.min(t,1)),this.$fill.style.width=t*100+"%"}return this._inputFocused||(this.$input.value=this._decimals===void 0?e:e.toFixed(this._decimals)),this}_initInput(){this.$input=document.createElement("input"),this.$input.setAttribute("type","text"),this.$input.setAttribute("aria-labelledby",this.$name.id),window.matchMedia("(pointer: coarse)").matches&&(this.$input.setAttribute("type","number"),this.$input.setAttribute("step","any")),this.$widget.appendChild(this.$input),this.$disable=this.$input;const t=()=>{let y=parseFloat(this.$input.value);isNaN(y)||(this._stepExplicit&&(y=this._snap(y)),this.setValue(this._clamp(y)))},i=y=>{const S=parseFloat(this.$input.value);isNaN(S)||(this._snapClampSetValue(S+y),this.$input.value=this.getValue())},r=y=>{y.key==="Enter"&&this.$input.blur(),y.code==="ArrowUp"&&(y.preventDefault(),i(this._step*this._arrowKeyMultiplier(y))),y.code==="ArrowDown"&&(y.preventDefault(),i(this._step*this._arrowKeyMultiplier(y)*-1))},s=y=>{this._inputFocused&&(y.preventDefault(),i(this._step*this._normalizeMouseWheel(y)))};let o=!1,a,l,c,u,d;const h=5,f=y=>{a=y.clientX,l=c=y.clientY,o=!0,u=this.getValue(),d=0,window.addEventListener("mousemove",_),window.addEventListener("mouseup",v)},_=y=>{if(o){const S=y.clientX-a,M=y.clientY-l;Math.abs(M)>h?(y.preventDefault(),this.$input.blur(),o=!1,this._setDraggingStyle(!0,"vertical")):Math.abs(S)>h&&v()}if(!o){const S=y.clientY-c;d-=S*this._step*this._arrowKeyMultiplier(y),u+d>this._max?d=this._max-u:u+d<this._min&&(d=this._min-u),this._snapClampSetValue(u+d)}c=y.clientY},v=()=>{this._setDraggingStyle(!1,"vertical"),this._callOnFinishChange(),window.removeEventListener("mousemove",_),window.removeEventListener("mouseup",v)},g=()=>{this._inputFocused=!0},m=()=>{this._inputFocused=!1,this.updateDisplay(),this._callOnFinishChange()};this.$input.addEventListener("input",t),this.$input.addEventListener("keydown",r),this.$input.addEventListener("wheel",s,{passive:!1}),this.$input.addEventListener("mousedown",f),this.$input.addEventListener("focus",g),this.$input.addEventListener("blur",m)}_initSlider(){this._hasSlider=!0,this.$slider=document.createElement("div"),this.$slider.classList.add("slider"),this.$fill=document.createElement("div"),this.$fill.classList.add("fill"),this.$slider.appendChild(this.$fill),this.$widget.insertBefore(this.$slider,this.$input),this.domElement.classList.add("hasSlider");const e=(m,y,S,M,R)=>(m-y)/(S-y)*(R-M)+M,t=m=>{const y=this.$slider.getBoundingClientRect();let S=e(m,y.left,y.right,this._min,this._max);this._snapClampSetValue(S)},i=m=>{this._setDraggingStyle(!0),t(m.clientX),window.addEventListener("mousemove",r),window.addEventListener("mouseup",s)},r=m=>{t(m.clientX)},s=()=>{this._callOnFinishChange(),this._setDraggingStyle(!1),window.removeEventListener("mousemove",r),window.removeEventListener("mouseup",s)};let o=!1,a,l;const c=m=>{m.preventDefault(),this._setDraggingStyle(!0),t(m.touches[0].clientX),o=!1},u=m=>{m.touches.length>1||(this._hasScrollBar?(a=m.touches[0].clientX,l=m.touches[0].clientY,o=!0):c(m),window.addEventListener("touchmove",d,{passive:!1}),window.addEventListener("touchend",h))},d=m=>{if(o){const y=m.touches[0].clientX-a,S=m.touches[0].clientY-l;Math.abs(y)>Math.abs(S)?c(m):(window.removeEventListener("touchmove",d),window.removeEventListener("touchend",h))}else m.preventDefault(),t(m.touches[0].clientX)},h=()=>{this._callOnFinishChange(),this._setDraggingStyle(!1),window.removeEventListener("touchmove",d),window.removeEventListener("touchend",h)},f=this._callOnFinishChange.bind(this),_=400;let v;const g=m=>{if(Math.abs(m.deltaX)<Math.abs(m.deltaY)&&this._hasScrollBar)return;m.preventDefault();const S=this._normalizeMouseWheel(m)*this._step;this._snapClampSetValue(this.getValue()+S),this.$input.value=this.getValue(),clearTimeout(v),v=setTimeout(f,_)};this.$slider.addEventListener("mousedown",i),this.$slider.addEventListener("touchstart",u,{passive:!1}),this.$slider.addEventListener("wheel",g,{passive:!1})}_setDraggingStyle(e,t="horizontal"){this.$slider&&this.$slider.classList.toggle("active",e),document.body.classList.toggle("lil-gui-dragging",e),document.body.classList.toggle(`lil-gui-${t}`,e)}_getImplicitStep(){return this._hasMin&&this._hasMax?(this._max-this._min)/1e3:.1}_onUpdateMinMax(){!this._hasSlider&&this._hasMin&&this._hasMax&&(this._stepExplicit||this.step(this._getImplicitStep(),!1),this._initSlider(),this.updateDisplay())}_normalizeMouseWheel(e){let{deltaX:t,deltaY:i}=e;return Math.floor(e.deltaY)!==e.deltaY&&e.wheelDelta&&(t=0,i=-e.wheelDelta/120,i*=this._stepExplicit?1:10),t+-i}_arrowKeyMultiplier(e){let t=this._stepExplicit?1:10;return e.shiftKey?t*=10:e.altKey&&(t/=10),t}_snap(e){const t=Math.round(e/this._step)*this._step;return parseFloat(t.toPrecision(15))}_clamp(e){return e<this._min&&(e=this._min),e>this._max&&(e=this._max),e}_snapClampSetValue(e){this.setValue(this._clamp(this._snap(e)))}get _hasScrollBar(){const e=this.parent.root.$children;return e.scrollHeight>e.clientHeight}get _hasMin(){return this._min!==void 0}get _hasMax(){return this._max!==void 0}}class dS extends li{constructor(e,t,i,r){super(e,t,i,"option"),this.$select=document.createElement("select"),this.$select.setAttribute("aria-labelledby",this.$name.id),this.$display=document.createElement("div"),this.$display.classList.add("display"),this.$select.addEventListener("change",()=>{this.setValue(this._values[this.$select.selectedIndex]),this._callOnFinishChange()}),this.$select.addEventListener("focus",()=>{this.$display.classList.add("focus")}),this.$select.addEventListener("blur",()=>{this.$display.classList.remove("focus")}),this.$widget.appendChild(this.$select),this.$widget.appendChild(this.$display),this.$disable=this.$select,this.options(r)}options(e){return this._values=Array.isArray(e)?e:Object.values(e),this._names=Array.isArray(e)?e:Object.keys(e),this.$select.replaceChildren(),this._names.forEach(t=>{const i=document.createElement("option");i.textContent=t,this.$select.appendChild(i)}),this.updateDisplay(),this}updateDisplay(){const e=this.getValue(),t=this._values.indexOf(e);return this.$select.selectedIndex=t,this.$display.textContent=t===-1?e:this._names[t],this}}class hS extends li{constructor(e,t,i){super(e,t,i,"string"),this.$input=document.createElement("input"),this.$input.setAttribute("type","text"),this.$input.setAttribute("spellcheck","false"),this.$input.setAttribute("aria-labelledby",this.$name.id),this.$input.addEventListener("input",()=>{this.setValue(this.$input.value)}),this.$input.addEventListener("keydown",r=>{r.code==="Enter"&&this.$input.blur()}),this.$input.addEventListener("blur",()=>{this._callOnFinishChange()}),this.$widget.appendChild(this.$input),this.$disable=this.$input,this.updateDisplay()}updateDisplay(){return this.$input.value=this.getValue(),this}}const fS=`.lil-gui {
  font-family: var(--font-family);
  font-size: var(--font-size);
  line-height: 1;
  font-weight: normal;
  font-style: normal;
  text-align: left;
  color: var(--text-color);
  user-select: none;
  -webkit-user-select: none;
  touch-action: manipulation;
  --background-color: #1f1f1f;
  --text-color: #ebebeb;
  --title-background-color: #111111;
  --title-text-color: #ebebeb;
  --widget-color: #424242;
  --hover-color: #4f4f4f;
  --focus-color: #595959;
  --number-color: #2cc9ff;
  --string-color: #a2db3c;
  --font-size: 11px;
  --input-font-size: 11px;
  --font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
  --font-family-mono: Menlo, Monaco, Consolas, "Droid Sans Mono", monospace;
  --padding: 4px;
  --spacing: 4px;
  --widget-height: 20px;
  --title-height: calc(var(--widget-height) + var(--spacing) * 1.25);
  --name-width: 45%;
  --slider-knob-width: 2px;
  --slider-input-width: 27%;
  --color-input-width: 27%;
  --slider-input-min-width: 45px;
  --color-input-min-width: 45px;
  --folder-indent: 7px;
  --widget-padding: 0 0 0 3px;
  --widget-border-radius: 2px;
  --checkbox-size: calc(0.75 * var(--widget-height));
  --scrollbar-width: 5px;
}
.lil-gui, .lil-gui * {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}
.lil-gui.root {
  width: var(--width, 245px);
  display: flex;
  flex-direction: column;
  background: var(--background-color);
}
.lil-gui.root > .title {
  background: var(--title-background-color);
  color: var(--title-text-color);
}
.lil-gui.root > .children {
  overflow-x: hidden;
  overflow-y: auto;
}
.lil-gui.root > .children::-webkit-scrollbar {
  width: var(--scrollbar-width);
  height: var(--scrollbar-width);
  background: var(--background-color);
}
.lil-gui.root > .children::-webkit-scrollbar-thumb {
  border-radius: var(--scrollbar-width);
  background: var(--focus-color);
}
@media (pointer: coarse) {
  .lil-gui.allow-touch-styles, .lil-gui.allow-touch-styles .lil-gui {
    --widget-height: 28px;
    --padding: 6px;
    --spacing: 6px;
    --font-size: 13px;
    --input-font-size: 16px;
    --folder-indent: 10px;
    --scrollbar-width: 7px;
    --slider-input-min-width: 50px;
    --color-input-min-width: 65px;
  }
}
.lil-gui.force-touch-styles, .lil-gui.force-touch-styles .lil-gui {
  --widget-height: 28px;
  --padding: 6px;
  --spacing: 6px;
  --font-size: 13px;
  --input-font-size: 16px;
  --folder-indent: 10px;
  --scrollbar-width: 7px;
  --slider-input-min-width: 50px;
  --color-input-min-width: 65px;
}
.lil-gui.autoPlace {
  max-height: 100%;
  position: fixed;
  top: 0;
  right: 15px;
  z-index: 1001;
}

.lil-gui .controller {
  display: flex;
  align-items: center;
  padding: 0 var(--padding);
  margin: var(--spacing) 0;
}
.lil-gui .controller.disabled {
  opacity: 0.5;
}
.lil-gui .controller.disabled, .lil-gui .controller.disabled * {
  pointer-events: none !important;
}
.lil-gui .controller > .name {
  min-width: var(--name-width);
  flex-shrink: 0;
  white-space: pre;
  padding-right: var(--spacing);
  line-height: var(--widget-height);
}
.lil-gui .controller .widget {
  position: relative;
  display: flex;
  align-items: center;
  width: 100%;
  min-height: var(--widget-height);
}
.lil-gui .controller.string input {
  color: var(--string-color);
}
.lil-gui .controller.boolean {
  cursor: pointer;
}
.lil-gui .controller.color .display {
  width: 100%;
  height: var(--widget-height);
  border-radius: var(--widget-border-radius);
  position: relative;
}
@media (hover: hover) {
  .lil-gui .controller.color .display:hover:before {
    content: " ";
    display: block;
    position: absolute;
    border-radius: var(--widget-border-radius);
    border: 1px solid #fff9;
    top: 0;
    right: 0;
    bottom: 0;
    left: 0;
  }
}
.lil-gui .controller.color input[type=color] {
  opacity: 0;
  width: 100%;
  height: 100%;
  cursor: pointer;
}
.lil-gui .controller.color input[type=text] {
  margin-left: var(--spacing);
  font-family: var(--font-family-mono);
  min-width: var(--color-input-min-width);
  width: var(--color-input-width);
  flex-shrink: 0;
}
.lil-gui .controller.option select {
  opacity: 0;
  position: absolute;
  width: 100%;
  max-width: 100%;
}
.lil-gui .controller.option .display {
  position: relative;
  pointer-events: none;
  border-radius: var(--widget-border-radius);
  height: var(--widget-height);
  line-height: var(--widget-height);
  max-width: 100%;
  overflow: hidden;
  word-break: break-all;
  padding-left: 0.55em;
  padding-right: 1.75em;
  background: var(--widget-color);
}
@media (hover: hover) {
  .lil-gui .controller.option .display.focus {
    background: var(--focus-color);
  }
}
.lil-gui .controller.option .display.active {
  background: var(--focus-color);
}
.lil-gui .controller.option .display:after {
  font-family: "lil-gui";
  content: "↕";
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  padding-right: 0.375em;
}
.lil-gui .controller.option .widget,
.lil-gui .controller.option select {
  cursor: pointer;
}
@media (hover: hover) {
  .lil-gui .controller.option .widget:hover .display {
    background: var(--hover-color);
  }
}
.lil-gui .controller.number input {
  color: var(--number-color);
}
.lil-gui .controller.number.hasSlider input {
  margin-left: var(--spacing);
  width: var(--slider-input-width);
  min-width: var(--slider-input-min-width);
  flex-shrink: 0;
}
.lil-gui .controller.number .slider {
  width: 100%;
  height: var(--widget-height);
  background: var(--widget-color);
  border-radius: var(--widget-border-radius);
  padding-right: var(--slider-knob-width);
  overflow: hidden;
  cursor: ew-resize;
  touch-action: pan-y;
}
@media (hover: hover) {
  .lil-gui .controller.number .slider:hover {
    background: var(--hover-color);
  }
}
.lil-gui .controller.number .slider.active {
  background: var(--focus-color);
}
.lil-gui .controller.number .slider.active .fill {
  opacity: 0.95;
}
.lil-gui .controller.number .fill {
  height: 100%;
  border-right: var(--slider-knob-width) solid var(--number-color);
  box-sizing: content-box;
}

.lil-gui-dragging .lil-gui {
  --hover-color: var(--widget-color);
}
.lil-gui-dragging * {
  cursor: ew-resize !important;
}

.lil-gui-dragging.lil-gui-vertical * {
  cursor: ns-resize !important;
}

.lil-gui .title {
  height: var(--title-height);
  line-height: calc(var(--title-height) - 4px);
  font-weight: 600;
  padding: 0 var(--padding);
  -webkit-tap-highlight-color: transparent;
  cursor: pointer;
  outline: none;
  text-decoration-skip: objects;
}
.lil-gui .title:before {
  font-family: "lil-gui";
  content: "▾";
  padding-right: 2px;
  display: inline-block;
}
.lil-gui .title:active {
  background: var(--title-background-color);
  opacity: 0.75;
}
@media (hover: hover) {
  body:not(.lil-gui-dragging) .lil-gui .title:hover {
    background: var(--title-background-color);
    opacity: 0.85;
  }
  .lil-gui .title:focus {
    text-decoration: underline var(--focus-color);
  }
}
.lil-gui.root > .title:focus {
  text-decoration: none !important;
}
.lil-gui.closed > .title:before {
  content: "▸";
}
.lil-gui.closed > .children {
  transform: translateY(-7px);
  opacity: 0;
}
.lil-gui.closed:not(.transition) > .children {
  display: none;
}
.lil-gui.transition > .children {
  transition-duration: 300ms;
  transition-property: height, opacity, transform;
  transition-timing-function: cubic-bezier(0.2, 0.6, 0.35, 1);
  overflow: hidden;
  pointer-events: none;
}
.lil-gui .children:empty:before {
  content: "Empty";
  padding: 0 var(--padding);
  margin: var(--spacing) 0;
  display: block;
  height: var(--widget-height);
  font-style: italic;
  line-height: var(--widget-height);
  opacity: 0.5;
}
.lil-gui.root > .children > .lil-gui > .title {
  border: 0 solid var(--widget-color);
  border-width: 1px 0;
  transition: border-color 300ms;
}
.lil-gui.root > .children > .lil-gui.closed > .title {
  border-bottom-color: transparent;
}
.lil-gui + .controller {
  border-top: 1px solid var(--widget-color);
  margin-top: 0;
  padding-top: var(--spacing);
}
.lil-gui .lil-gui .lil-gui > .title {
  border: none;
}
.lil-gui .lil-gui .lil-gui > .children {
  border: none;
  margin-left: var(--folder-indent);
  border-left: 2px solid var(--widget-color);
}
.lil-gui .lil-gui .controller {
  border: none;
}

.lil-gui label, .lil-gui input, .lil-gui button {
  -webkit-tap-highlight-color: transparent;
}
.lil-gui input {
  border: 0;
  outline: none;
  font-family: var(--font-family);
  font-size: var(--input-font-size);
  border-radius: var(--widget-border-radius);
  height: var(--widget-height);
  background: var(--widget-color);
  color: var(--text-color);
  width: 100%;
}
@media (hover: hover) {
  .lil-gui input:hover {
    background: var(--hover-color);
  }
  .lil-gui input:active {
    background: var(--focus-color);
  }
}
.lil-gui input:disabled {
  opacity: 1;
}
.lil-gui input[type=text],
.lil-gui input[type=number] {
  padding: var(--widget-padding);
  -moz-appearance: textfield;
}
.lil-gui input[type=text]:focus,
.lil-gui input[type=number]:focus {
  background: var(--focus-color);
}
.lil-gui input[type=checkbox] {
  appearance: none;
  width: var(--checkbox-size);
  height: var(--checkbox-size);
  border-radius: var(--widget-border-radius);
  text-align: center;
  cursor: pointer;
}
.lil-gui input[type=checkbox]:checked:before {
  font-family: "lil-gui";
  content: "✓";
  font-size: var(--checkbox-size);
  line-height: var(--checkbox-size);
}
@media (hover: hover) {
  .lil-gui input[type=checkbox]:focus {
    box-shadow: inset 0 0 0 1px var(--focus-color);
  }
}
.lil-gui button {
  outline: none;
  cursor: pointer;
  font-family: var(--font-family);
  font-size: var(--font-size);
  color: var(--text-color);
  width: 100%;
  height: var(--widget-height);
  text-transform: none;
  background: var(--widget-color);
  border-radius: var(--widget-border-radius);
  border: none;
}
@media (hover: hover) {
  .lil-gui button:hover {
    background: var(--hover-color);
  }
  .lil-gui button:focus {
    box-shadow: inset 0 0 0 1px var(--focus-color);
  }
}
.lil-gui button:active {
  background: var(--focus-color);
}

@font-face {
  font-family: "lil-gui";
  src: url("data:application/font-woff;charset=utf-8;base64,d09GRgABAAAAAAUsAAsAAAAACJwAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAABHU1VCAAABCAAAAH4AAADAImwmYE9TLzIAAAGIAAAAPwAAAGBKqH5SY21hcAAAAcgAAAD0AAACrukyyJBnbHlmAAACvAAAAF8AAACEIZpWH2hlYWQAAAMcAAAAJwAAADZfcj2zaGhlYQAAA0QAAAAYAAAAJAC5AHhobXR4AAADXAAAABAAAABMAZAAAGxvY2EAAANsAAAAFAAAACgCEgIybWF4cAAAA4AAAAAeAAAAIAEfABJuYW1lAAADoAAAASIAAAIK9SUU/XBvc3QAAATEAAAAZgAAAJCTcMc2eJxVjbEOgjAURU+hFRBK1dGRL+ALnAiToyMLEzFpnPz/eAshwSa97517c/MwwJmeB9kwPl+0cf5+uGPZXsqPu4nvZabcSZldZ6kfyWnomFY/eScKqZNWupKJO6kXN3K9uCVoL7iInPr1X5baXs3tjuMqCtzEuagm/AAlzQgPAAB4nGNgYRBlnMDAysDAYM/gBiT5oLQBAwuDJAMDEwMrMwNWEJDmmsJwgCFeXZghBcjlZMgFCzOiKOIFAB71Bb8AeJy1kjFuwkAQRZ+DwRAwBtNQRUGKQ8OdKCAWUhAgKLhIuAsVSpWz5Bbkj3dEgYiUIszqWdpZe+Z7/wB1oCYmIoboiwiLT2WjKl/jscrHfGg/pKdMkyklC5Zs2LEfHYpjcRoPzme9MWWmk3dWbK9ObkWkikOetJ554fWyoEsmdSlt+uR0pCJR34b6t/TVg1SY3sYvdf8vuiKrpyaDXDISiegp17p7579Gp3p++y7HPAiY9pmTibljrr85qSidtlg4+l25GLCaS8e6rRxNBmsnERunKbaOObRz7N72ju5vdAjYpBXHgJylOAVsMseDAPEP8LYoUHicY2BiAAEfhiAGJgZWBgZ7RnFRdnVJELCQlBSRlATJMoLV2DK4glSYs6ubq5vbKrJLSbGrgEmovDuDJVhe3VzcXFwNLCOILB/C4IuQ1xTn5FPilBTj5FPmBAB4WwoqAHicY2BkYGAA4sk1sR/j+W2+MnAzpDBgAyEMQUCSg4EJxAEAwUgFHgB4nGNgZGBgSGFggJMhDIwMqEAYAByHATJ4nGNgAIIUNEwmAABl3AGReJxjYAACIQYlBiMGJ3wQAEcQBEV4nGNgZGBgEGZgY2BiAAEQyQWEDAz/wXwGAAsPATIAAHicXdBNSsNAHAXwl35iA0UQXYnMShfS9GPZA7T7LgIu03SSpkwzYTIt1BN4Ak/gKTyAeCxfw39jZkjymzcvAwmAW/wgwHUEGDb36+jQQ3GXGot79L24jxCP4gHzF/EIr4jEIe7wxhOC3g2TMYy4Q7+Lu/SHuEd/ivt4wJd4wPxbPEKMX3GI5+DJFGaSn4qNzk8mcbKSR6xdXdhSzaOZJGtdapd4vVPbi6rP+cL7TGXOHtXKll4bY1Xl7EGnPtp7Xy2n00zyKLVHfkHBa4IcJ2oD3cgggWvt/V/FbDrUlEUJhTn/0azVWbNTNr0Ens8de1tceK9xZmfB1CPjOmPH4kitmvOubcNpmVTN3oFJyjzCvnmrwhJTzqzVj9jiSX911FjeAAB4nG3HMRKCMBBA0f0giiKi4DU8k0V2GWbIZDOh4PoWWvq6J5V8If9NVNQcaDhyouXMhY4rPTcG7jwYmXhKq8Wz+p762aNaeYXom2n3m2dLTVgsrCgFJ7OTmIkYbwIbC6vIB7WmFfAAAA==") format("woff");
}`;function pS(n){const e=document.createElement("style");e.innerHTML=n;const t=document.querySelector("head link[rel=stylesheet], head style");t?document.head.insertBefore(e,t):document.head.appendChild(e)}let kh=!1;class zu{constructor({parent:e,autoPlace:t=e===void 0,container:i,width:r,title:s="Controls",closeFolders:o=!1,injectStyles:a=!0,touchStyles:l=!0}={}){if(this.parent=e,this.root=e?e.root:this,this.children=[],this.controllers=[],this.folders=[],this._closed=!1,this._hidden=!1,this.domElement=document.createElement("div"),this.domElement.classList.add("lil-gui"),this.$title=document.createElement("div"),this.$title.classList.add("title"),this.$title.setAttribute("role","button"),this.$title.setAttribute("aria-expanded",!0),this.$title.setAttribute("tabindex",0),this.$title.addEventListener("click",()=>this.openAnimated(this._closed)),this.$title.addEventListener("keydown",c=>{(c.code==="Enter"||c.code==="Space")&&(c.preventDefault(),this.$title.click())}),this.$title.addEventListener("touchstart",()=>{},{passive:!0}),this.$children=document.createElement("div"),this.$children.classList.add("children"),this.domElement.appendChild(this.$title),this.domElement.appendChild(this.$children),this.title(s),this.parent){this.parent.children.push(this),this.parent.folders.push(this),this.parent.$children.appendChild(this.domElement);return}this.domElement.classList.add("root"),l&&this.domElement.classList.add("allow-touch-styles"),!kh&&a&&(pS(fS),kh=!0),i?i.appendChild(this.domElement):t&&(this.domElement.classList.add("autoPlace"),document.body.appendChild(this.domElement)),r&&this.domElement.style.setProperty("--width",r+"px"),this._closeFolders=o}add(e,t,i,r,s){if(Object(i)===i)return new dS(this,e,t,i);const o=e[t];switch(typeof o){case"number":return new uS(this,e,t,i,r,s);case"boolean":return new iS(this,e,t);case"string":return new hS(this,e,t);case"function":return new Xl(this,e,t)}console.error(`gui.add failed
	property:`,t,`
	object:`,e,`
	value:`,o)}addColor(e,t,i=1){return new cS(this,e,t,i)}addFolder(e){const t=new zu({parent:this,title:e});return this.root._closeFolders&&t.close(),t}load(e,t=!0){return e.controllers&&this.controllers.forEach(i=>{i instanceof Xl||i._name in e.controllers&&i.load(e.controllers[i._name])}),t&&e.folders&&this.folders.forEach(i=>{i._title in e.folders&&i.load(e.folders[i._title])}),this}save(e=!0){const t={controllers:{},folders:{}};return this.controllers.forEach(i=>{if(!(i instanceof Xl)){if(i._name in t.controllers)throw new Error(`Cannot save GUI with duplicate property "${i._name}"`);t.controllers[i._name]=i.save()}}),e&&this.folders.forEach(i=>{if(i._title in t.folders)throw new Error(`Cannot save GUI with duplicate folder "${i._title}"`);t.folders[i._title]=i.save()}),t}open(e=!0){return this._setClosed(!e),this.$title.setAttribute("aria-expanded",!this._closed),this.domElement.classList.toggle("closed",this._closed),this}close(){return this.open(!1)}_setClosed(e){this._closed!==e&&(this._closed=e,this._callOnOpenClose(this))}show(e=!0){return this._hidden=!e,this.domElement.style.display=this._hidden?"none":"",this}hide(){return this.show(!1)}openAnimated(e=!0){return this._setClosed(!e),this.$title.setAttribute("aria-expanded",!this._closed),requestAnimationFrame(()=>{const t=this.$children.clientHeight;this.$children.style.height=t+"px",this.domElement.classList.add("transition");const i=s=>{s.target===this.$children&&(this.$children.style.height="",this.domElement.classList.remove("transition"),this.$children.removeEventListener("transitionend",i))};this.$children.addEventListener("transitionend",i);const r=e?this.$children.scrollHeight:0;this.domElement.classList.toggle("closed",!e),requestAnimationFrame(()=>{this.$children.style.height=r+"px"})}),this}title(e){return this._title=e,this.$title.textContent=e,this}reset(e=!0){return(e?this.controllersRecursive():this.controllers).forEach(i=>i.reset()),this}onChange(e){return this._onChange=e,this}_callOnChange(e){this.parent&&this.parent._callOnChange(e),this._onChange!==void 0&&this._onChange.call(this,{object:e.object,property:e.property,value:e.getValue(),controller:e})}onFinishChange(e){return this._onFinishChange=e,this}_callOnFinishChange(e){this.parent&&this.parent._callOnFinishChange(e),this._onFinishChange!==void 0&&this._onFinishChange.call(this,{object:e.object,property:e.property,value:e.getValue(),controller:e})}onOpenClose(e){return this._onOpenClose=e,this}_callOnOpenClose(e){this.parent&&this.parent._callOnOpenClose(e),this._onOpenClose!==void 0&&this._onOpenClose.call(this,e)}destroy(){this.parent&&(this.parent.children.splice(this.parent.children.indexOf(this),1),this.parent.folders.splice(this.parent.folders.indexOf(this),1)),this.domElement.parentElement&&this.domElement.parentElement.removeChild(this.domElement),Array.from(this.children).forEach(e=>e.destroy())}controllersRecursive(){let e=Array.from(this.controllers);return this.folders.forEach(t=>{e=e.concat(t.controllersRecursive())}),e}foldersRecursive(){let e=Array.from(this.folders);return this.folders.forEach(t=>{e=e.concat(t.foldersRecursive())}),e}}/*! js-yaml 4.2.0 https://github.com/nodeca/js-yaml @license MIT */var mS=Object.create,Tp=Object.defineProperty,gS=Object.getOwnPropertyDescriptor,_S=Object.getOwnPropertyNames,vS=Object.getPrototypeOf,yS=Object.prototype.hasOwnProperty,wt=(n,e)=>()=>(e||(n((e={exports:{}}).exports,e),n=null),e.exports),xS=(n,e,t,i)=>{if(e&&typeof e=="object"||typeof e=="function")for(var r=_S(e),s=0,o=r.length,a;s<o;s++)a=r[s],!yS.call(n,a)&&a!==t&&Tp(n,a,{get:(l=>e[l]).bind(null,a),enumerable:!(i=gS(e,a))||i.enumerable});return n},bS=(n,e,t)=>(t=n!=null?mS(vS(n)):{},xS(Tp(t,"default",{value:n,enumerable:!0}),n)),go=wt((n,e)=>{function t(l){return typeof l>"u"||l===null}function i(l){return typeof l=="object"&&l!==null}function r(l){return Array.isArray(l)?l:t(l)?[]:[l]}function s(l,c){if(c){const u=Object.keys(c);for(let d=0,h=u.length;d<h;d+=1){const f=u[d];l[f]=c[f]}}return l}function o(l,c){let u="";for(let d=0;d<c;d+=1)u+=l;return u}function a(l){return l===0&&Number.NEGATIVE_INFINITY===1/l}e.exports.isNothing=t,e.exports.isObject=i,e.exports.toArray=r,e.exports.repeat=o,e.exports.isNegativeZero=a,e.exports.extend=s}),_o=wt((n,e)=>{function t(r,s){let o="";const a=r.reason||"(unknown reason)";return r.mark?(r.mark.name&&(o+='in "'+r.mark.name+'" '),o+="("+(r.mark.line+1)+":"+(r.mark.column+1)+")",!s&&r.mark.snippet&&(o+=`

`+r.mark.snippet),a+" "+o):a}function i(r,s){Error.call(this),this.name="YAMLException",this.reason=r,this.mark=s,this.message=t(this,!1),Error.captureStackTrace?Error.captureStackTrace(this,this.constructor):this.stack=new Error().stack||""}i.prototype=Object.create(Error.prototype),i.prototype.constructor=i,i.prototype.toString=function(s){return this.name+": "+t(this,s)},e.exports=i}),SS=wt((n,e)=>{var t=go();function i(o,a,l,c,u){let d="",h="";const f=Math.floor(u/2)-1;return c-a>f&&(d=" ... ",a=c-f+d.length),l-c>f&&(h=" ...",l=c+f-h.length),{str:d+o.slice(a,l).replace(/\t/g,"→")+h,pos:c-a+d.length}}function r(o,a){return t.repeat(" ",a-o.length)+o}function s(o,a){if(a=Object.create(a||null),!o.buffer)return null;a.maxLength||(a.maxLength=79),typeof a.indent!="number"&&(a.indent=1),typeof a.linesBefore!="number"&&(a.linesBefore=3),typeof a.linesAfter!="number"&&(a.linesAfter=2);const l=/\r?\n|\r|\0/g,c=[0],u=[];let d,h=-1;for(;d=l.exec(o.buffer);)u.push(d.index),c.push(d.index+d[0].length),o.position<=d.index&&h<0&&(h=c.length-2);h<0&&(h=c.length-1);let f="";const _=Math.min(o.line+a.linesAfter,u.length).toString().length,v=a.maxLength-(a.indent+_+3);for(let m=1;m<=a.linesBefore&&!(h-m<0);m++){const y=i(o.buffer,c[h-m],u[h-m],o.position-(c[h]-c[h-m]),v);f=t.repeat(" ",a.indent)+r((o.line-m+1).toString(),_)+" | "+y.str+`
`+f}const g=i(o.buffer,c[h],u[h],o.position,v);f+=t.repeat(" ",a.indent)+r((o.line+1).toString(),_)+" | "+g.str+`
`,f+=t.repeat("-",a.indent+_+3+g.pos)+`^
`;for(let m=1;m<=a.linesAfter&&!(h+m>=u.length);m++){const y=i(o.buffer,c[h+m],u[h+m],o.position-(c[h]-c[h+m]),v);f+=t.repeat(" ",a.indent)+r((o.line+m+1).toString(),_)+" | "+y.str+`
`}return f.replace(/\n$/,"")}e.exports=s}),vn=wt((n,e)=>{var t=_o(),i=["kind","multi","resolve","construct","instanceOf","predicate","represent","representName","defaultStyle","styleAliases"],r=["scalar","sequence","mapping"];function s(a){const l={};return a!==null&&Object.keys(a).forEach(function(c){a[c].forEach(function(u){l[String(u)]=c})}),l}function o(a,l){if(l=l||{},Object.keys(l).forEach(function(c){if(i.indexOf(c)===-1)throw new t('Unknown option "'+c+'" is met in definition of "'+a+'" YAML type.')}),this.options=l,this.tag=a,this.kind=l.kind||null,this.resolve=l.resolve||function(){return!0},this.construct=l.construct||function(c){return c},this.instanceOf=l.instanceOf||null,this.predicate=l.predicate||null,this.represent=l.represent||null,this.representName=l.representName||null,this.defaultStyle=l.defaultStyle||null,this.multi=l.multi||!1,this.styleAliases=s(l.styleAliases||null),r.indexOf(this.kind)===-1)throw new t('Unknown kind "'+this.kind+'" is specified for "'+a+'" YAML type.')}e.exports=o}),Ap=wt((n,e)=>{var t=_o(),i=vn();function r(a,l){const c=[];return a[l].forEach(function(u){let d=c.length;c.forEach(function(h,f){h.tag===u.tag&&h.kind===u.kind&&h.multi===u.multi&&(d=f)}),c[d]=u}),c}function s(){const a={scalar:{},sequence:{},mapping:{},fallback:{},multi:{scalar:[],sequence:[],mapping:[],fallback:[]}};function l(c){c.multi?(a.multi[c.kind].push(c),a.multi.fallback.push(c)):a[c.kind][c.tag]=a.fallback[c.tag]=c}for(let c=0,u=arguments.length;c<u;c+=1)arguments[c].forEach(l);return a}function o(a){return this.extend(a)}o.prototype.extend=function(l){let c=[],u=[];if(l instanceof i)u.push(l);else if(Array.isArray(l))u=u.concat(l);else if(l&&(Array.isArray(l.implicit)||Array.isArray(l.explicit)))l.implicit&&(c=c.concat(l.implicit)),l.explicit&&(u=u.concat(l.explicit));else throw new t("Schema.extend argument should be a Type, [ Type ], or a schema definition ({ implicit: [...], explicit: [...] })");c.forEach(function(h){if(!(h instanceof i))throw new t("Specified list of YAML types (or a single Type object) contains a non-Type object.");if(h.loadKind&&h.loadKind!=="scalar")throw new t("There is a non-scalar type in the implicit list of a schema. Implicit resolving of such types is not supported.");if(h.multi)throw new t("There is a multi type in the implicit list of a schema. Multi tags can only be listed as explicit.")}),u.forEach(function(h){if(!(h instanceof i))throw new t("Specified list of YAML types (or a single Type object) contains a non-Type object.")});const d=Object.create(o.prototype);return d.implicit=(this.implicit||[]).concat(c),d.explicit=(this.explicit||[]).concat(u),d.compiledImplicit=r(d,"implicit"),d.compiledExplicit=r(d,"explicit"),d.compiledTypeMap=s(d.compiledImplicit,d.compiledExplicit),d},e.exports=o}),Cp=wt((n,e)=>{e.exports=new(vn())("tag:yaml.org,2002:str",{kind:"scalar",construct:function(t){return t!==null?t:""}})}),Pp=wt((n,e)=>{e.exports=new(vn())("tag:yaml.org,2002:seq",{kind:"sequence",construct:function(t){return t!==null?t:[]}})}),Rp=wt((n,e)=>{e.exports=new(vn())("tag:yaml.org,2002:map",{kind:"mapping",construct:function(t){return t!==null?t:{}}})}),Lp=wt((n,e)=>{e.exports=new(Ap())({explicit:[Cp(),Pp(),Rp()]})}),Ip=wt((n,e)=>{var t=vn();function i(o){if(o===null)return!0;const a=o.length;return a===1&&o==="~"||a===4&&(o==="null"||o==="Null"||o==="NULL")}function r(){return null}function s(o){return o===null}e.exports=new t("tag:yaml.org,2002:null",{kind:"scalar",resolve:i,construct:r,predicate:s,represent:{canonical:function(){return"~"},lowercase:function(){return"null"},uppercase:function(){return"NULL"},camelcase:function(){return"Null"},empty:function(){return""}},defaultStyle:"lowercase"})}),Dp=wt((n,e)=>{var t=vn();function i(o){if(o===null)return!1;const a=o.length;return a===4&&(o==="true"||o==="True"||o==="TRUE")||a===5&&(o==="false"||o==="False"||o==="FALSE")}function r(o){return o==="true"||o==="True"||o==="TRUE"}function s(o){return Object.prototype.toString.call(o)==="[object Boolean]"}e.exports=new t("tag:yaml.org,2002:bool",{kind:"scalar",resolve:i,construct:r,predicate:s,represent:{lowercase:function(o){return o?"true":"false"},uppercase:function(o){return o?"TRUE":"FALSE"},camelcase:function(o){return o?"True":"False"}},defaultStyle:"lowercase"})}),Np=wt((n,e)=>{var t=go(),i=vn();function r(d){return d>=48&&d<=57||d>=65&&d<=70||d>=97&&d<=102}function s(d){return d>=48&&d<=55}function o(d){return d>=48&&d<=57}function a(d){if(d===null)return!1;const h=d.length;let f=0,_=!1;if(!h)return!1;let v=d[f];if((v==="-"||v==="+")&&(v=d[++f]),v==="0"){if(f+1===h)return!0;if(v=d[++f],v==="b"){for(f++;f<h;f++){if(v=d[f],v!=="0"&&v!=="1")return!1;_=!0}return _&&Number.isFinite(l(d))}if(v==="x"){for(f++;f<h;f++){if(!r(d.charCodeAt(f)))return!1;_=!0}return _&&Number.isFinite(l(d))}if(v==="o"){for(f++;f<h;f++){if(!s(d.charCodeAt(f)))return!1;_=!0}return _&&Number.isFinite(l(d))}}for(;f<h;f++){if(!o(d.charCodeAt(f)))return!1;_=!0}return _?Number.isFinite(l(d)):!1}function l(d){let h=d,f=1,_=h[0];if((_==="-"||_==="+")&&(_==="-"&&(f=-1),h=h.slice(1),_=h[0]),h==="0")return 0;if(_==="0"){if(h[1]==="b")return f*parseInt(h.slice(2),2);if(h[1]==="x")return f*parseInt(h.slice(2),16);if(h[1]==="o")return f*parseInt(h.slice(2),8)}return f*parseInt(h,10)}function c(d){return l(d)}function u(d){return Object.prototype.toString.call(d)==="[object Number]"&&d%1===0&&!t.isNegativeZero(d)}e.exports=new i("tag:yaml.org,2002:int",{kind:"scalar",resolve:a,construct:c,predicate:u,represent:{binary:function(d){return d>=0?"0b"+d.toString(2):"-0b"+d.toString(2).slice(1)},octal:function(d){return d>=0?"0o"+d.toString(8):"-0o"+d.toString(8).slice(1)},decimal:function(d){return d.toString(10)},hexadecimal:function(d){return d>=0?"0x"+d.toString(16).toUpperCase():"-0x"+d.toString(16).toUpperCase().slice(1)}},defaultStyle:"decimal",styleAliases:{binary:[2,"bin"],octal:[8,"oct"],decimal:[10,"dec"],hexadecimal:[16,"hex"]}})}),Up=wt((n,e)=>{var t=go(),i=vn(),r=new RegExp("^(?:[-+]?(?:[0-9]+)(?:\\.[0-9]*)?(?:[eE][-+]?[0-9]+)?|\\.[0-9]+(?:[eE][-+]?[0-9]+)?|[-+]?\\.(?:inf|Inf|INF)|\\.(?:nan|NaN|NAN))$"),s=new RegExp("^(?:[-+]?\\.(?:inf|Inf|INF)|\\.(?:nan|NaN|NAN))$");function o(d){return d===null||!r.test(d)?!1:Number.isFinite(parseFloat(d,10))?!0:s.test(d)}function a(d){let h=d.toLowerCase();const f=h[0]==="-"?-1:1;return"+-".indexOf(h[0])>=0&&(h=h.slice(1)),h===".inf"?f===1?Number.POSITIVE_INFINITY:Number.NEGATIVE_INFINITY:h===".nan"?NaN:f*parseFloat(h,10)}var l=/^[-+]?[0-9]+e/;function c(d,h){if(isNaN(d))switch(h){case"lowercase":return".nan";case"uppercase":return".NAN";case"camelcase":return".NaN"}else if(Number.POSITIVE_INFINITY===d)switch(h){case"lowercase":return".inf";case"uppercase":return".INF";case"camelcase":return".Inf"}else if(Number.NEGATIVE_INFINITY===d)switch(h){case"lowercase":return"-.inf";case"uppercase":return"-.INF";case"camelcase":return"-.Inf"}else if(t.isNegativeZero(d))return"-0.0";const f=d.toString(10);return l.test(f)?f.replace("e",".e"):f}function u(d){return Object.prototype.toString.call(d)==="[object Number]"&&(d%1!==0||t.isNegativeZero(d))}e.exports=new i("tag:yaml.org,2002:float",{kind:"scalar",resolve:o,construct:a,predicate:u,represent:c,defaultStyle:"lowercase"})}),Fp=wt((n,e)=>{e.exports=Lp().extend({implicit:[Ip(),Dp(),Np(),Up()]})}),Op=wt((n,e)=>{e.exports=Fp()}),Bp=wt((n,e)=>{var t=vn(),i=new RegExp("^([0-9][0-9][0-9][0-9])-([0-9][0-9])-([0-9][0-9])$"),r=new RegExp("^([0-9][0-9][0-9][0-9])-([0-9][0-9]?)-([0-9][0-9]?)(?:[Tt]|[ \\t]+)([0-9][0-9]?):([0-9][0-9]):([0-9][0-9])(?:\\.([0-9]*))?(?:[ \\t]*(Z|([-+])([0-9][0-9]?)(?::([0-9][0-9]))?))?$");function s(l){return l===null?!1:i.exec(l)!==null||r.exec(l)!==null}function o(l){let c=0,u=null,d=i.exec(l);if(d===null&&(d=r.exec(l)),d===null)throw new Error("Date resolve error");const h=+d[1],f=+d[2]-1,_=+d[3];if(!d[4])return new Date(Date.UTC(h,f,_));const v=+d[4],g=+d[5],m=+d[6];if(d[7]){for(c=d[7].slice(0,3);c.length<3;)c+="0";c=+c}if(d[9]){const S=+d[10],M=+(d[11]||0);u=(S*60+M)*6e4,d[9]==="-"&&(u=-u)}const y=new Date(Date.UTC(h,f,_,v,g,m,c));return u&&y.setTime(y.getTime()-u),y}function a(l){return l.toISOString()}e.exports=new t("tag:yaml.org,2002:timestamp",{kind:"scalar",resolve:s,construct:o,instanceOf:Date,represent:a})}),kp=wt((n,e)=>{var t=vn();function i(r){return r==="<<"||r===null}e.exports=new t("tag:yaml.org,2002:merge",{kind:"scalar",resolve:i})}),zp=wt((n,e)=>{var t=vn(),i=`ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=
\r`;function r(l){if(l===null)return!1;let c=0;const u=l.length,d=i;for(let h=0;h<u;h++){const f=d.indexOf(l.charAt(h));if(!(f>64)){if(f<0)return!1;c+=6}}return c%8===0}function s(l){const c=l.replace(/[\r\n=]/g,""),u=c.length,d=i;let h=0;const f=[];for(let v=0;v<u;v++)v%4===0&&v&&(f.push(h>>16&255),f.push(h>>8&255),f.push(h&255)),h=h<<6|d.indexOf(c.charAt(v));const _=u%4*6;return _===0?(f.push(h>>16&255),f.push(h>>8&255),f.push(h&255)):_===18?(f.push(h>>10&255),f.push(h>>2&255)):_===12&&f.push(h>>4&255),new Uint8Array(f)}function o(l){let c="",u=0;const d=l.length,h=i;for(let _=0;_<d;_++)_%3===0&&_&&(c+=h[u>>18&63],c+=h[u>>12&63],c+=h[u>>6&63],c+=h[u&63]),u=(u<<8)+l[_];const f=d%3;return f===0?(c+=h[u>>18&63],c+=h[u>>12&63],c+=h[u>>6&63],c+=h[u&63]):f===2?(c+=h[u>>10&63],c+=h[u>>4&63],c+=h[u<<2&63],c+=h[64]):f===1&&(c+=h[u>>2&63],c+=h[u<<4&63],c+=h[64],c+=h[64]),c}function a(l){return Object.prototype.toString.call(l)==="[object Uint8Array]"}e.exports=new t("tag:yaml.org,2002:binary",{kind:"scalar",resolve:r,construct:s,predicate:a,represent:o})}),Hp=wt((n,e)=>{var t=vn(),i=Object.prototype.hasOwnProperty,r=Object.prototype.toString;function s(a){if(a===null)return!0;const l=[],c=a;for(let u=0,d=c.length;u<d;u+=1){const h=c[u];let f=!1;if(r.call(h)!=="[object Object]")return!1;let _;for(_ in h)if(i.call(h,_))if(!f)f=!0;else return!1;if(!f)return!1;if(l.indexOf(_)===-1)l.push(_);else return!1}return!0}function o(a){return a!==null?a:[]}e.exports=new t("tag:yaml.org,2002:omap",{kind:"sequence",resolve:s,construct:o})}),Vp=wt((n,e)=>{var t=vn(),i=Object.prototype.toString;function r(o){if(o===null)return!0;const a=o,l=new Array(a.length);for(let c=0,u=a.length;c<u;c+=1){const d=a[c];if(i.call(d)!=="[object Object]")return!1;const h=Object.keys(d);if(h.length!==1)return!1;l[c]=[h[0],d[h[0]]]}return!0}function s(o){if(o===null)return[];const a=o,l=new Array(a.length);for(let c=0,u=a.length;c<u;c+=1){const d=a[c],h=Object.keys(d);l[c]=[h[0],d[h[0]]]}return l}e.exports=new t("tag:yaml.org,2002:pairs",{kind:"sequence",resolve:r,construct:s})}),Gp=wt((n,e)=>{var t=vn(),i=Object.prototype.hasOwnProperty;function r(o){if(o===null)return!0;const a=o;for(const l in a)if(i.call(a,l)&&a[l]!==null)return!1;return!0}function s(o){return o!==null?o:{}}e.exports=new t("tag:yaml.org,2002:set",{kind:"mapping",resolve:r,construct:s})}),Hu=wt((n,e)=>{e.exports=Op().extend({implicit:[Bp(),kp()],explicit:[zp(),Hp(),Vp(),Gp()]})}),MS=wt((n,e)=>{var t=go(),i=_o(),r=SS(),s=Hu(),o=Object.prototype.hasOwnProperty,a=1,l=2,c=3,u=4,d=1,h=2,f=3,_=/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x84\x86-\x9F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/,v=/[\x85\u2028\u2029]/,g=/[,\[\]{}]/,m=/^(?:!|!!|![0-9A-Za-z-]+!)$/,y=/^(?:!|[^,\[\]{}])(?:%[0-9a-f]{2}|[0-9a-z\-#;/?:@&=+$,_.!~*'()\[\]])*$/i;function S(p){return Object.prototype.toString.call(p)}function M(p){return p===10||p===13}function R(p){return p===9||p===32}function A(p){return p===9||p===32||p===10||p===13}function C(p){return p===44||p===91||p===93||p===123||p===125}function D(p){if(p>=48&&p<=57)return p-48;const H=p|32;return H>=97&&H<=102?H-97+10:-1}function $(p){return p===120?2:p===117?4:p===85?8:0}function b(p){return p>=48&&p<=57?p-48:-1}function E(p){switch(p){case 48:return"\0";case 97:return"\x07";case 98:return"\b";case 116:return"	";case 9:return"	";case 110:return`
`;case 118:return"\v";case 102:return"\f";case 114:return"\r";case 101:return"\x1B";case 32:return" ";case 34:return'"';case 47:return"/";case 92:return"\\";case 78:return"";case 95:return" ";case 76:return"\u2028";case 80:return"\u2029";default:return""}}function F(p){return p<=65535?String.fromCharCode(p):String.fromCharCode((p-65536>>10)+55296,(p-65536&1023)+56320)}function O(p,H,ee){H==="__proto__"?Object.defineProperty(p,H,{configurable:!0,enumerable:!0,writable:!0,value:ee}):p[H]=ee}var X=new Array(256),re=new Array(256);for(let p=0;p<256;p++)X[p]=E(p)?1:0,re[p]=E(p);function K(p,H){this.input=p,this.filename=H.filename||null,this.schema=H.schema||s,this.onWarning=H.onWarning||null,this.legacy=H.legacy||!1,this.json=H.json||!1,this.listener=H.listener||null,this.maxDepth=typeof H.maxDepth=="number"?H.maxDepth:100,this.maxMergeSeqLength=typeof H.maxMergeSeqLength=="number"?H.maxMergeSeqLength:20,this.implicitTypes=this.schema.compiledImplicit,this.typeMap=this.schema.compiledTypeMap,this.length=p.length,this.position=0,this.line=0,this.lineStart=0,this.lineIndent=0,this.depth=0,this.firstTabInLine=-1,this.documents=[],this.anchorMapTransactions=[]}function he(p,H){const ee={name:p.filename,buffer:p.input.slice(0,-1),position:p.position,line:p.line,column:p.position-p.lineStart};return ee.snippet=r(ee),new i(H,ee)}function j(p,H){throw he(p,H)}function Ee(p,H){p.onWarning&&p.onWarning.call(null,he(p,H))}function _e(p,H,ee){const te=p.anchorMapTransactions;if(te.length!==0){const q=te[te.length-1];o.call(q,H)||(q[H]={existed:o.call(p.anchorMap,H),value:p.anchorMap[H]})}p.anchorMap[H]=ee}function Se(p){p.anchorMapTransactions.push(Object.create(null))}function Me(p){const H=p.anchorMapTransactions.pop(),ee=p.anchorMapTransactions;if(ee.length===0)return;const te=ee[ee.length-1],q=Object.keys(H);for(let ce=0,w=q.length;ce<w;ce+=1){const Y=q[ce];o.call(te,Y)||(te[Y]=H[Y])}}function ze(p){const H=p.anchorMapTransactions.pop(),ee=Object.keys(H);for(let te=ee.length-1;te>=0;te-=1){const q=H[ee[te]];q.existed?p.anchorMap[ee[te]]=q.value:delete p.anchorMap[ee[te]]}}function ue(p){return{position:p.position,line:p.line,lineStart:p.lineStart,lineIndent:p.lineIndent,firstTabInLine:p.firstTabInLine,tag:p.tag,anchor:p.anchor,kind:p.kind,result:p.result}}function me(p,H){p.position=H.position,p.line=H.line,p.lineStart=H.lineStart,p.lineIndent=H.lineIndent,p.firstTabInLine=H.firstTabInLine,p.tag=H.tag,p.anchor=H.anchor,p.kind=H.kind,p.result=H.result}var we={YAML:function(H,ee,te){H.version!==null&&j(H,"duplication of %YAML directive"),te.length!==1&&j(H,"YAML directive accepts exactly one argument");const q=/^([0-9]+)\.([0-9]+)$/.exec(te[0]);q===null&&j(H,"ill-formed argument of the YAML directive");const ce=parseInt(q[1],10),w=parseInt(q[2],10);ce!==1&&j(H,"unacceptable YAML version of the document"),H.version=te[0],H.checkLineBreaks=w<2,w!==1&&w!==2&&Ee(H,"unsupported YAML version of the document")},TAG:function(H,ee,te){let q;te.length!==2&&j(H,"TAG directive accepts exactly two arguments");const ce=te[0];q=te[1],m.test(ce)||j(H,"ill-formed tag handle (first argument) of the TAG directive"),o.call(H.tagMap,ce)&&j(H,'there is a previously declared suffix for "'+ce+'" tag handle'),y.test(q)||j(H,"ill-formed tag prefix (second argument) of the TAG directive");try{q=decodeURIComponent(q)}catch{j(H,"tag prefix is malformed: "+q)}H.tagMap[ce]=q}};function ye(p,H,ee,te){if(H<ee){const q=p.input.slice(H,ee);if(te)for(let ce=0,w=q.length;ce<w;ce+=1){const Y=q.charCodeAt(ce);Y===9||Y>=32&&Y<=1114111||j(p,"expected valid JSON character")}else _.test(q)&&j(p,"the stream contains non-printable characters");p.result+=q}}function Ve(p,H,ee,te){t.isObject(ee)||j(p,"cannot merge mappings; the provided source object is unacceptable");const q=Object.keys(ee);for(let ce=0,w=q.length;ce<w;ce+=1){const Y=q[ce];o.call(H,Y)||(O(H,Y,ee[Y]),te[Y]=!0)}}function Ne(p,H,ee,te,q,ce,w,Y,N){if(Array.isArray(q)){q=Array.prototype.slice.call(q);for(let B=0,k=q.length;B<k;B+=1)Array.isArray(q[B])&&j(p,"nested arrays are not supported inside keys"),typeof q=="object"&&S(q[B])==="[object Object]"&&(q[B]="[object Object]")}if(typeof q=="object"&&S(q)==="[object Object]"&&(q="[object Object]"),q=String(q),H===null&&(H={}),te==="tag:yaml.org,2002:merge")if(Array.isArray(ce)){ce.length>p.maxMergeSeqLength&&j(p,"merge sequence length exceeded maxMergeSeqLength ("+p.maxMergeSeqLength+")");const B=new Set;for(let k=0,W=ce.length;k<W;k+=1){const J=ce[k];B.has(J)||(B.add(J),Ve(p,H,J,ee))}}else Ve(p,H,ce,ee);else!p.json&&!o.call(ee,q)&&o.call(H,q)&&(p.line=w||p.line,p.lineStart=Y||p.lineStart,p.position=N||p.position,j(p,"duplicated mapping key")),O(H,q,ce),delete ee[q];return H}function qe(p){const H=p.input.charCodeAt(p.position);H===10?p.position++:H===13?(p.position++,p.input.charCodeAt(p.position)===10&&p.position++):j(p,"a line break is expected"),p.line+=1,p.lineStart=p.position,p.firstTabInLine=-1}function Be(p,H,ee){let te=0,q=p.input.charCodeAt(p.position);for(;q!==0;){for(;R(q);)q===9&&p.firstTabInLine===-1&&(p.firstTabInLine=p.position),q=p.input.charCodeAt(++p.position);if(H&&q===35)do q=p.input.charCodeAt(++p.position);while(q!==10&&q!==13&&q!==0);if(M(q))for(qe(p),q=p.input.charCodeAt(p.position),te++,p.lineIndent=0;q===32;)p.lineIndent++,q=p.input.charCodeAt(++p.position);else break}return ee!==-1&&te!==0&&p.lineIndent<ee&&Ee(p,"deficient indentation"),te}function Ge(p){let H=p.position,ee=p.input.charCodeAt(H);return!!((ee===45||ee===46)&&ee===p.input.charCodeAt(H+1)&&ee===p.input.charCodeAt(H+2)&&(H+=3,ee=p.input.charCodeAt(H),ee===0||A(ee)))}function G(p,H){H===1?p.result+=" ":H>1&&(p.result+=t.repeat(`
`,H-1))}function vt(p,H,ee){let te,q,ce,w,Y,N;const B=p.kind,k=p.result;let W=p.input.charCodeAt(p.position);if(A(W)||C(W)||W===35||W===38||W===42||W===33||W===124||W===62||W===39||W===34||W===37||W===64||W===96)return!1;if(W===63||W===45){const J=p.input.charCodeAt(p.position+1);if(A(J)||ee&&C(J))return!1}for(p.kind="scalar",p.result="",te=q=p.position,ce=!1;W!==0;){if(W===58){const J=p.input.charCodeAt(p.position+1);if(A(J)||ee&&C(J))break}else if(W===35){if(A(p.input.charCodeAt(p.position-1)))break}else{if(p.position===p.lineStart&&Ge(p)||ee&&C(W))break;if(M(W))if(w=p.line,Y=p.lineStart,N=p.lineIndent,Be(p,!1,-1),p.lineIndent>=H){ce=!0,W=p.input.charCodeAt(p.position);continue}else{p.position=q,p.line=w,p.lineStart=Y,p.lineIndent=N;break}}ce&&(ye(p,te,q,!1),G(p,p.line-w),te=q=p.position,ce=!1),R(W)||(q=p.position+1),W=p.input.charCodeAt(++p.position)}return ye(p,te,q,!1),p.result?!0:(p.kind=B,p.result=k,!1)}function et(p,H){let ee,te,q=p.input.charCodeAt(p.position);if(q!==39)return!1;for(p.kind="scalar",p.result="",p.position++,ee=te=p.position;(q=p.input.charCodeAt(p.position))!==0;)if(q===39)if(ye(p,ee,p.position,!0),q=p.input.charCodeAt(++p.position),q===39)ee=p.position,p.position++,te=p.position;else return!0;else M(q)?(ye(p,ee,te,!0),G(p,Be(p,!1,H)),ee=te=p.position):p.position===p.lineStart&&Ge(p)?j(p,"unexpected end of the document within a single quoted scalar"):(p.position++,R(q)||(te=p.position));j(p,"unexpected end of the stream within a single quoted scalar")}function Ze(p,H){let ee,te,q,ce=p.input.charCodeAt(p.position);if(ce!==34)return!1;for(p.kind="scalar",p.result="",p.position++,ee=te=p.position;(ce=p.input.charCodeAt(p.position))!==0;){if(ce===34)return ye(p,ee,p.position,!0),p.position++,!0;if(ce===92){if(ye(p,ee,p.position,!0),ce=p.input.charCodeAt(++p.position),M(ce))Be(p,!1,H);else if(ce<256&&X[ce])p.result+=re[ce],p.position++;else if((q=$(ce))>0){let w=q,Y=0;for(;w>0;w--)ce=p.input.charCodeAt(++p.position),(q=D(ce))>=0?Y=(Y<<4)+q:j(p,"expected hexadecimal character");p.result+=F(Y),p.position++}else j(p,"unknown escape sequence");ee=te=p.position}else M(ce)?(ye(p,ee,te,!0),G(p,Be(p,!1,H)),ee=te=p.position):p.position===p.lineStart&&Ge(p)?j(p,"unexpected end of the document within a double quoted scalar"):(p.position++,R(ce)||(te=p.position))}j(p,"unexpected end of the stream within a double quoted scalar")}function We(p,H){let ee=!0,te,q,ce;const w=p.tag;let Y;const N=p.anchor;let B,k,W,J;const ae=Object.create(null);let pe,xe,Le,Re=p.input.charCodeAt(p.position);if(Re===91)B=93,J=!1,Y=[];else if(Re===123)B=125,J=!0,Y={};else return!1;for(p.anchor!==null&&_e(p,p.anchor,Y),Re=p.input.charCodeAt(++p.position);Re!==0;){if(Be(p,!0,H),Re=p.input.charCodeAt(p.position),Re===B)return p.position++,p.tag=w,p.anchor=N,p.kind=J?"mapping":"sequence",p.result=Y,!0;ee?Re===44&&j(p,"expected the node content, but found ','"):j(p,"missed comma between flow collection entries"),xe=pe=Le=null,k=W=!1,Re===63&&A(p.input.charCodeAt(p.position+1))&&(k=W=!0,p.position++,Be(p,!0,H)),te=p.line,q=p.lineStart,ce=p.position,de(p,H,a,!1,!0),xe=p.tag,pe=p.result,Be(p,!0,H),Re=p.input.charCodeAt(p.position),(W||p.line===te)&&Re===58&&(k=!0,Re=p.input.charCodeAt(++p.position),Be(p,!0,H),de(p,H,a,!1,!0),Le=p.result),J?Ne(p,Y,ae,xe,pe,Le,te,q,ce):k?Y.push(Ne(p,null,ae,xe,pe,Le,te,q,ce)):Y.push(pe),Be(p,!0,H),Re=p.input.charCodeAt(p.position),Re===44?(ee=!0,Re=p.input.charCodeAt(++p.position)):ee=!1}j(p,"unexpected end of the stream within a flow collection")}function at(p,H){let ee,te=d,q=!1,ce=!1,w=H,Y=0,N=!1,B,k=p.input.charCodeAt(p.position);if(k===124)ee=!1;else if(k===62)ee=!0;else return!1;for(p.kind="scalar",p.result="";k!==0;)if(k=p.input.charCodeAt(++p.position),k===43||k===45)d===te?te=k===43?f:h:j(p,"repeat of a chomping mode identifier");else if((B=b(k))>=0)B===0?j(p,"bad explicit indentation width of a block scalar; it cannot be less than one"):ce?j(p,"repeat of an indentation width identifier"):(w=H+B-1,ce=!0);else break;if(R(k)){do k=p.input.charCodeAt(++p.position);while(R(k));if(k===35)do k=p.input.charCodeAt(++p.position);while(!M(k)&&k!==0)}for(;k!==0;){for(qe(p),p.lineIndent=0,k=p.input.charCodeAt(p.position);(!ce||p.lineIndent<w)&&k===32;)p.lineIndent++,k=p.input.charCodeAt(++p.position);if(!ce&&p.lineIndent>w&&(w=p.lineIndent),M(k)){Y++;continue}if(!ce&&w===0&&j(p,"missing indentation for block scalar"),p.lineIndent<w){te===f?p.result+=t.repeat(`
`,q?1+Y:Y):te===d&&q&&(p.result+=`
`);break}ee?R(k)?(N=!0,p.result+=t.repeat(`
`,q?1+Y:Y)):N?(N=!1,p.result+=t.repeat(`
`,Y+1)):Y===0?q&&(p.result+=" "):p.result+=t.repeat(`
`,Y):p.result+=t.repeat(`
`,q?1+Y:Y),q=!0,ce=!0,Y=0;const W=p.position;for(;!M(k)&&k!==0;)k=p.input.charCodeAt(++p.position);ye(p,W,p.position,!1)}return!0}function He(p,H){const ee=p.tag,te=p.anchor,q=[];let ce=!1;if(p.firstTabInLine!==-1)return!1;p.anchor!==null&&_e(p,p.anchor,q);let w=p.input.charCodeAt(p.position);for(;w!==0&&(p.firstTabInLine!==-1&&(p.position=p.firstTabInLine,j(p,"tab characters must not be used in indentation")),!(w!==45||!A(p.input.charCodeAt(p.position+1))));){if(ce=!0,p.position++,Be(p,!0,-1)&&p.lineIndent<=H){q.push(null),w=p.input.charCodeAt(p.position);continue}const Y=p.line;if(de(p,H,c,!1,!0),q.push(p.result),Be(p,!0,-1),w=p.input.charCodeAt(p.position),(p.line===Y||p.lineIndent>H)&&w!==0)j(p,"bad indentation of a sequence entry");else if(p.lineIndent<H)break}return ce?(p.tag=ee,p.anchor=te,p.kind="sequence",p.result=q,!0):!1}function U(p,H,ee){let te,q,ce,w;const Y=p.tag,N=p.anchor,B={},k=Object.create(null);let W=null,J=null,ae=null,pe=!1,xe=!1;if(p.firstTabInLine!==-1)return!1;p.anchor!==null&&_e(p,p.anchor,B);let Le=p.input.charCodeAt(p.position);for(;Le!==0;){!pe&&p.firstTabInLine!==-1&&(p.position=p.firstTabInLine,j(p,"tab characters must not be used in indentation"));const Re=p.input.charCodeAt(p.position+1),Ye=p.line;if((Le===63||Le===58)&&A(Re))Le===63?(pe&&(Ne(p,B,k,W,J,null,q,ce,w),W=J=ae=null),xe=!0,pe=!0,te=!0):pe?(pe=!1,te=!0):j(p,"incomplete explicit mapping pair; a key node is missed; or followed by a non-tabulated empty line"),p.position+=1,Le=Re;else{if(q=p.line,ce=p.lineStart,w=p.position,!de(p,ee,l,!1,!0))break;if(p.line===Ye){for(Le=p.input.charCodeAt(p.position);R(Le);)Le=p.input.charCodeAt(++p.position);if(Le===58)Le=p.input.charCodeAt(++p.position),A(Le)||j(p,"a whitespace character is expected after the key-value separator within a block mapping"),pe&&(Ne(p,B,k,W,J,null,q,ce,w),W=J=ae=null),xe=!0,pe=!1,te=!1,W=p.tag,J=p.result;else if(xe)j(p,"can not read an implicit mapping pair; a colon is missed");else return p.tag=Y,p.anchor=N,!0}else if(xe)j(p,"can not read a block mapping entry; a multiline key may not be an implicit key");else return p.tag=Y,p.anchor=N,!0}if((p.line===Ye||p.lineIndent>H)&&(pe&&(q=p.line,ce=p.lineStart,w=p.position),de(p,H,u,!0,te)&&(pe?J=p.result:ae=p.result),pe||(Ne(p,B,k,W,J,ae,q,ce,w),W=J=ae=null),Be(p,!0,-1),Le=p.input.charCodeAt(p.position)),(p.line===Ye||p.lineIndent>H)&&Le!==0)j(p,"bad indentation of a mapping entry");else if(p.lineIndent<H)break}return pe&&Ne(p,B,k,W,J,null,q,ce,w),xe&&(p.tag=Y,p.anchor=N,p.kind="mapping",p.result=B),xe}function P(p){let H=!1,ee=!1,te,q,ce=p.input.charCodeAt(p.position);if(ce!==33)return!1;p.tag!==null&&j(p,"duplication of a tag property"),ce=p.input.charCodeAt(++p.position),ce===60?(H=!0,ce=p.input.charCodeAt(++p.position)):ce===33?(ee=!0,te="!!",ce=p.input.charCodeAt(++p.position)):te="!";let w=p.position;if(H){do ce=p.input.charCodeAt(++p.position);while(ce!==0&&ce!==62);p.position<p.length?(q=p.input.slice(w,p.position),ce=p.input.charCodeAt(++p.position)):j(p,"unexpected end of the stream within a verbatim tag")}else{for(;ce!==0&&!A(ce);)ce===33&&(ee?j(p,"tag suffix cannot contain exclamation marks"):(te=p.input.slice(w-1,p.position+1),m.test(te)||j(p,"named tag handle cannot contain such characters"),ee=!0,w=p.position+1)),ce=p.input.charCodeAt(++p.position);q=p.input.slice(w,p.position),g.test(q)&&j(p,"tag suffix cannot contain flow indicator characters")}q&&!y.test(q)&&j(p,"tag name cannot contain such characters: "+q);try{q=decodeURIComponent(q)}catch{j(p,"tag name is malformed: "+q)}return H?p.tag=q:o.call(p.tagMap,te)?p.tag=p.tagMap[te]+q:te==="!"?p.tag="!"+q:te==="!!"?p.tag="tag:yaml.org,2002:"+q:j(p,'undeclared tag handle "'+te+'"'),!0}function ne(p){let H=p.input.charCodeAt(p.position);if(H!==38)return!1;p.anchor!==null&&j(p,"duplication of an anchor property"),H=p.input.charCodeAt(++p.position);const ee=p.position;for(;H!==0&&!A(H)&&!C(H);)H=p.input.charCodeAt(++p.position);return p.position===ee&&j(p,"name of an anchor node must contain at least one character"),p.anchor=p.input.slice(ee,p.position),!0}function fe(p){let H=p.input.charCodeAt(p.position);if(H!==42)return!1;H=p.input.charCodeAt(++p.position);const ee=p.position;for(;H!==0&&!A(H)&&!C(H);)H=p.input.charCodeAt(++p.position);p.position===ee&&j(p,"name of an alias node must contain at least one character");const te=p.input.slice(ee,p.position);return o.call(p.anchorMap,te)||j(p,'unidentified alias "'+te+'"'),p.result=p.anchorMap[te],Be(p,!0,-1),!0}function ge(p,H,ee,te){const q=ue(p);return Se(p),me(p,H),p.tag=null,p.anchor=null,p.kind=null,p.result=null,U(p,ee,te)&&p.kind==="mapping"?(Me(p),!0):(ze(p),me(p,q),!1)}function de(p,H,ee,te,q){let ce,w,Y=1,N=!1,B=!1,k=null,W,J,ae;p.depth>=p.maxDepth&&j(p,"nesting exceeded maxDepth ("+p.maxDepth+")"),p.depth+=1,p.listener!==null&&p.listener("open",p),p.tag=null,p.anchor=null,p.kind=null,p.result=null;const pe=ce=w=u===ee||c===ee;if(te&&Be(p,!0,-1)&&(N=!0,p.lineIndent>H?Y=1:p.lineIndent===H?Y=0:p.lineIndent<H&&(Y=-1)),Y===1)for(;;){const xe=p.input.charCodeAt(p.position),Le=ue(p);if(N&&(xe===33&&p.tag!==null||xe===38&&p.anchor!==null)||!P(p)&&!ne(p))break;k===null&&(k=Le),Be(p,!0,-1)?(N=!0,w=pe,p.lineIndent>H?Y=1:p.lineIndent===H?Y=0:p.lineIndent<H&&(Y=-1)):w=!1}if(w&&(w=N||q),Y===1||u===ee)if(a===ee||l===ee?J=H:J=H+1,ae=p.position-p.lineStart,Y===1)if(w&&(He(p,ae)||U(p,ae,J))||We(p,J))B=!0;else{const xe=p.input.charCodeAt(p.position);k!==null&&pe&&!w&&xe!==124&&xe!==62&&ge(p,k,k.position-k.lineStart,J)||ce&&at(p,J)||et(p,J)||Ze(p,J)?B=!0:fe(p)?(B=!0,(p.tag!==null||p.anchor!==null)&&j(p,"alias node should not have any properties")):vt(p,J,a===ee)&&(B=!0,p.tag===null&&(p.tag="?")),p.anchor!==null&&_e(p,p.anchor,p.result)}else Y===0&&(B=w&&He(p,ae));if(p.tag===null)p.anchor!==null&&_e(p,p.anchor,p.result);else if(p.tag==="?"){p.result!==null&&p.kind!=="scalar"&&j(p,'unacceptable node kind for !<?> tag; it should be "scalar", not "'+p.kind+'"');for(let xe=0,Le=p.implicitTypes.length;xe<Le;xe+=1)if(W=p.implicitTypes[xe],W.resolve(p.result)){p.result=W.construct(p.result),p.tag=W.tag,p.anchor!==null&&_e(p,p.anchor,p.result);break}}else if(p.tag!=="!"){if(o.call(p.typeMap[p.kind||"fallback"],p.tag))W=p.typeMap[p.kind||"fallback"][p.tag];else{W=null;const xe=p.typeMap.multi[p.kind||"fallback"];for(let Le=0,Re=xe.length;Le<Re;Le+=1)if(p.tag.slice(0,xe[Le].tag.length)===xe[Le].tag){W=xe[Le];break}}W||j(p,"unknown tag !<"+p.tag+">"),p.result!==null&&W.kind!==p.kind&&j(p,"unacceptable node kind for !<"+p.tag+'> tag; it should be "'+W.kind+'", not "'+p.kind+'"'),W.resolve(p.result,p.tag)?(p.result=W.construct(p.result,p.tag),p.anchor!==null&&_e(p,p.anchor,p.result)):j(p,"cannot resolve a node with !<"+p.tag+"> explicit tag")}return p.listener!==null&&p.listener("close",p),p.depth-=1,p.tag!==null||p.anchor!==null||B}function Fe(p){const H=p.position;let ee=!1,te;for(p.version=null,p.checkLineBreaks=p.legacy,p.tagMap=Object.create(null),p.anchorMap=Object.create(null);(te=p.input.charCodeAt(p.position))!==0&&(Be(p,!0,-1),te=p.input.charCodeAt(p.position),!(p.lineIndent>0||te!==37));){ee=!0,te=p.input.charCodeAt(++p.position);let q=p.position;for(;te!==0&&!A(te);)te=p.input.charCodeAt(++p.position);const ce=p.input.slice(q,p.position),w=[];for(ce.length<1&&j(p,"directive name must not be less than one character in length");te!==0;){for(;R(te);)te=p.input.charCodeAt(++p.position);if(te===35){do te=p.input.charCodeAt(++p.position);while(te!==0&&!M(te));break}if(M(te))break;for(q=p.position;te!==0&&!A(te);)te=p.input.charCodeAt(++p.position);w.push(p.input.slice(q,p.position))}te!==0&&qe(p),o.call(we,ce)?we[ce](p,ce,w):Ee(p,'unknown document directive "'+ce+'"')}if(Be(p,!0,-1),p.lineIndent===0&&p.input.charCodeAt(p.position)===45&&p.input.charCodeAt(p.position+1)===45&&p.input.charCodeAt(p.position+2)===45?(p.position+=3,Be(p,!0,-1)):ee&&j(p,"directives end mark is expected"),de(p,p.lineIndent-1,u,!1,!0),Be(p,!0,-1),p.checkLineBreaks&&v.test(p.input.slice(H,p.position))&&Ee(p,"non-ASCII line breaks are interpreted as content"),p.documents.push(p.result),p.position===p.lineStart&&Ge(p)){p.input.charCodeAt(p.position)===46&&(p.position+=3,Be(p,!0,-1));return}p.position<p.length-1&&j(p,"end of the stream or a document separator is expected")}function be(p,H){p=String(p),H=H||{},p.length!==0&&(p.charCodeAt(p.length-1)!==10&&p.charCodeAt(p.length-1)!==13&&(p+=`
`),p.charCodeAt(0)===65279&&(p=p.slice(1)));const ee=new K(p,H),te=p.indexOf("\0");for(te!==-1&&(ee.position=te,j(ee,"null byte is not allowed in input")),ee.input+="\0";ee.input.charCodeAt(ee.position)===32;)ee.lineIndent+=1,ee.position+=1;for(;ee.position<ee.length-1;)Fe(ee);return ee.documents}function Ae(p,H,ee){H!==null&&typeof H=="object"&&typeof ee>"u"&&(ee=H,H=null);const te=be(p,ee);if(typeof H!="function")return te;for(let q=0,ce=te.length;q<ce;q+=1)H(te[q])}function T(p,H){const ee=be(p,H);if(ee.length!==0){if(ee.length===1)return ee[0];throw new i("expected a single document in the stream, but found more")}}e.exports.loadAll=Ae,e.exports.load=T}),wS=wt((n,e)=>{var t=go(),i=_o(),r=Hu(),s=Object.prototype.toString,o=Object.prototype.hasOwnProperty,a=65279,l=9,c=10,u=13,d=32,h=33,f=34,_=35,v=37,g=38,m=39,y=42,S=44,M=45,R=58,A=61,C=62,D=63,$=64,b=91,E=93,F=96,O=123,X=124,re=125,K={};K[0]="\\0",K[7]="\\a",K[8]="\\b",K[9]="\\t",K[10]="\\n",K[11]="\\v",K[12]="\\f",K[13]="\\r",K[27]="\\e",K[34]='\\"',K[92]="\\\\",K[133]="\\N",K[160]="\\_",K[8232]="\\L",K[8233]="\\P";var he=["y","Y","yes","Yes","YES","on","On","ON","n","N","no","No","NO","off","Off","OFF"],j=/^[-+]?[0-9_]+(?::[0-9_]+)+(?:\.[0-9_]*)?$/;function Ee(w,Y){if(Y===null)return{};const N={},B=Object.keys(Y);for(let k=0,W=B.length;k<W;k+=1){let J=B[k],ae=String(Y[J]);J.slice(0,2)==="!!"&&(J="tag:yaml.org,2002:"+J.slice(2));const pe=w.compiledTypeMap.fallback[J];pe&&o.call(pe.styleAliases,ae)&&(ae=pe.styleAliases[ae]),N[J]=ae}return N}function _e(w){let Y,N;const B=w.toString(16).toUpperCase();if(w<=255)Y="x",N=2;else if(w<=65535)Y="u",N=4;else if(w<=4294967295)Y="U",N=8;else throw new i("code point within a string may not be greater than 0xFFFFFFFF");return"\\"+Y+t.repeat("0",N-B.length)+B}var Se=1,Me=2;function ze(w){this.schema=w.schema||r,this.indent=Math.max(1,w.indent||2),this.noArrayIndent=w.noArrayIndent||!1,this.skipInvalid=w.skipInvalid||!1,this.flowLevel=t.isNothing(w.flowLevel)?-1:w.flowLevel,this.styleMap=Ee(this.schema,w.styles||null),this.sortKeys=w.sortKeys||!1,this.lineWidth=w.lineWidth||80,this.noRefs=w.noRefs||!1,this.noCompatMode=w.noCompatMode||!1,this.condenseFlow=w.condenseFlow||!1,this.quotingType=w.quotingType==='"'?Me:Se,this.forceQuotes=w.forceQuotes||!1,this.replacer=typeof w.replacer=="function"?w.replacer:null,this.implicitTypes=this.schema.compiledImplicit,this.explicitTypes=this.schema.compiledExplicit,this.tag=null,this.result="",this.duplicates=[],this.usedDuplicates=null}function ue(w,Y){const N=t.repeat(" ",Y);let B=0,k="";const W=w.length;for(;B<W;){let J;const ae=w.indexOf(`
`,B);ae===-1?(J=w.slice(B),B=W):(J=w.slice(B,ae+1),B=ae+1),J.length&&J!==`
`&&(k+=N),k+=J}return k}function me(w,Y){return`
`+t.repeat(" ",w.indent*Y)}function we(w,Y){for(let N=0,B=w.implicitTypes.length;N<B;N+=1)if(w.implicitTypes[N].resolve(Y))return!0;return!1}function ye(w){return w===d||w===l}function Ve(w){return w>=32&&w<=126||w>=161&&w<=55295&&w!==8232&&w!==8233||w>=57344&&w<=65533&&w!==a||w>=65536&&w<=1114111}function Ne(w){return Ve(w)&&w!==a&&w!==u&&w!==c}function qe(w,Y,N){const B=Ne(w),k=B&&!ye(w);return(N?B:B&&w!==S&&w!==b&&w!==E&&w!==O&&w!==re)&&w!==_&&!(Y===R&&!k)||Ne(Y)&&!ye(Y)&&w===_||Y===R&&k}function Be(w){return Ve(w)&&w!==a&&!ye(w)&&w!==M&&w!==D&&w!==R&&w!==S&&w!==b&&w!==E&&w!==O&&w!==re&&w!==_&&w!==g&&w!==y&&w!==h&&w!==X&&w!==A&&w!==C&&w!==m&&w!==f&&w!==v&&w!==$&&w!==F}function Ge(w){return!ye(w)&&w!==R}function G(w,Y){const N=w.charCodeAt(Y);let B;return N>=55296&&N<=56319&&Y+1<w.length&&(B=w.charCodeAt(Y+1),B>=56320&&B<=57343)?(N-55296)*1024+B-56320+65536:N}function vt(w){return/^\n* /.test(w)}var et=1,Ze=2,We=3,at=4,He=5;function U(w,Y,N,B,k,W,J,ae){let pe,xe=0,Le=null,Re=!1,Ye=!1;const dn=B!==-1;let ti=-1,Wn=Be(G(w,0))&&Ge(G(w,w.length-1));if(Y||J)for(pe=0;pe<w.length;xe>=65536?pe+=2:pe++){if(xe=G(w,pe),!Ve(xe))return He;Wn=Wn&&qe(xe,Le,ae),Le=xe}else{for(pe=0;pe<w.length;xe>=65536?pe+=2:pe++){if(xe=G(w,pe),xe===c)Re=!0,dn&&(Ye=Ye||pe-ti-1>B&&w[ti+1]!==" ",ti=pe);else if(!Ve(xe))return He;Wn=Wn&&qe(xe,Le,ae),Le=xe}Ye=Ye||dn&&pe-ti-1>B&&w[ti+1]!==" "}return!Re&&!Ye?Wn&&!J&&!k(w)?et:W===Me?He:Ze:N>9&&vt(w)?He:J?W===Me?He:Ze:Ye?at:We}function P(w,Y,N,B,k){w.dump=function(){if(Y.length===0)return w.quotingType===Me?'""':"''";if(!w.noCompatMode&&(he.indexOf(Y)!==-1||j.test(Y)))return w.quotingType===Me?'"'+Y+'"':"'"+Y+"'";const W=w.indent*Math.max(1,N),J=w.lineWidth===-1?-1:Math.max(Math.min(w.lineWidth,40),w.lineWidth-W),ae=B||w.flowLevel>-1&&N>=w.flowLevel;function pe(xe){return we(w,xe)}switch(U(Y,ae,w.indent,J,pe,w.quotingType,w.forceQuotes&&!B,k)){case et:return Y;case Ze:return"'"+Y.replace(/'/g,"''")+"'";case We:return"|"+ne(Y,w.indent)+fe(ue(Y,W));case at:return">"+ne(Y,w.indent)+fe(ue(ge(Y,J),W));case He:return'"'+Fe(Y)+'"';default:throw new i("impossible error: invalid scalar style")}}()}function ne(w,Y){const N=vt(w)?String(Y):"",B=w[w.length-1]===`
`;return N+(B&&(w[w.length-2]===`
`||w===`
`)?"+":B?"":"-")+`
`}function fe(w){return w[w.length-1]===`
`?w.slice(0,-1):w}function ge(w,Y){const N=/(\n+)([^\n]*)/g;let B=function(){let ae=w.indexOf(`
`);return ae=ae!==-1?ae:w.length,N.lastIndex=ae,de(w.slice(0,ae),Y)}(),k=w[0]===`
`||w[0]===" ",W,J;for(;J=N.exec(w);){const ae=J[1],pe=J[2];W=pe[0]===" ",B+=ae+(!k&&!W&&pe!==""?`
`:"")+de(pe,Y),k=W}return B}function de(w,Y){if(w===""||w[0]===" ")return w;const N=/ [^ ]/g;let B,k=0,W,J=0,ae=0,pe="";for(;B=N.exec(w);)ae=B.index,ae-k>Y&&(W=J>k?J:ae,pe+=`
`+w.slice(k,W),k=W+1),J=ae;return pe+=`
`,w.length-k>Y&&J>k?pe+=w.slice(k,J)+`
`+w.slice(J+1):pe+=w.slice(k),pe.slice(1)}function Fe(w){let Y="",N=0;for(let B=0;B<w.length;N>=65536?B+=2:B++){N=G(w,B);const k=K[N];!k&&Ve(N)?(Y+=w[B],N>=65536&&(Y+=w[B+1])):Y+=k||_e(N)}return Y}function be(w,Y,N){let B="";const k=w.tag;for(let W=0,J=N.length;W<J;W+=1){let ae=N[W];w.replacer&&(ae=w.replacer.call(N,String(W),ae)),(ee(w,Y,ae,!1,!1)||typeof ae>"u"&&ee(w,Y,null,!1,!1))&&(B!==""&&(B+=","+(w.condenseFlow?"":" ")),B+=w.dump)}w.tag=k,w.dump="["+B+"]"}function Ae(w,Y,N,B){let k="";const W=w.tag;for(let J=0,ae=N.length;J<ae;J+=1){let pe=N[J];w.replacer&&(pe=w.replacer.call(N,String(J),pe)),(ee(w,Y+1,pe,!0,!0,!1,!0)||typeof pe>"u"&&ee(w,Y+1,null,!0,!0,!1,!0))&&((!B||k!=="")&&(k+=me(w,Y)),w.dump&&c===w.dump.charCodeAt(0)?k+="-":k+="- ",k+=w.dump)}w.tag=W,w.dump=k||"[]"}function T(w,Y,N){let B="";const k=w.tag,W=Object.keys(N);for(let J=0,ae=W.length;J<ae;J+=1){let pe="";B!==""&&(pe+=", "),w.condenseFlow&&(pe+='"');const xe=W[J];let Le=N[xe];w.replacer&&(Le=w.replacer.call(N,xe,Le)),ee(w,Y,xe,!1,!1)&&(w.dump.length>1024&&(pe+="? "),pe+=w.dump+(w.condenseFlow?'"':"")+":"+(w.condenseFlow?"":" "),ee(w,Y,Le,!1,!1)&&(pe+=w.dump,B+=pe))}w.tag=k,w.dump="{"+B+"}"}function p(w,Y,N,B){let k="";const W=w.tag,J=Object.keys(N);if(w.sortKeys===!0)J.sort();else if(typeof w.sortKeys=="function")J.sort(w.sortKeys);else if(w.sortKeys)throw new i("sortKeys must be a boolean or a function");for(let ae=0,pe=J.length;ae<pe;ae+=1){let xe="";(!B||k!=="")&&(xe+=me(w,Y));const Le=J[ae];let Re=N[Le];if(w.replacer&&(Re=w.replacer.call(N,Le,Re)),!ee(w,Y+1,Le,!0,!0,!0))continue;const Ye=w.tag!==null&&w.tag!=="?"||w.dump&&w.dump.length>1024;Ye&&(w.dump&&c===w.dump.charCodeAt(0)?xe+="?":xe+="? "),xe+=w.dump,Ye&&(xe+=me(w,Y)),ee(w,Y+1,Re,!0,Ye)&&(w.dump&&c===w.dump.charCodeAt(0)?xe+=":":xe+=": ",xe+=w.dump,k+=xe)}w.tag=W,w.dump=k||"{}"}function H(w,Y,N){const B=N?w.explicitTypes:w.implicitTypes;for(let k=0,W=B.length;k<W;k+=1){const J=B[k];if((J.instanceOf||J.predicate)&&(!J.instanceOf||typeof Y=="object"&&Y instanceof J.instanceOf)&&(!J.predicate||J.predicate(Y))){if(N?J.multi&&J.representName?w.tag=J.representName(Y):w.tag=J.tag:w.tag="?",J.represent){const ae=w.styleMap[J.tag]||J.defaultStyle;let pe;if(s.call(J.represent)==="[object Function]")pe=J.represent(Y,ae);else if(o.call(J.represent,ae))pe=J.represent[ae](Y,ae);else throw new i("!<"+J.tag+'> tag resolver accepts not "'+ae+'" style');w.dump=pe}return!0}}return!1}function ee(w,Y,N,B,k,W,J){w.tag=null,w.dump=N,H(w,N,!1)||H(w,N,!0);const ae=s.call(w.dump),pe=B;B&&(B=w.flowLevel<0||w.flowLevel>Y);const xe=ae==="[object Object]"||ae==="[object Array]";let Le,Re;if(xe&&(Le=w.duplicates.indexOf(N),Re=Le!==-1),(w.tag!==null&&w.tag!=="?"||Re||w.indent!==2&&Y>0)&&(k=!1),Re&&w.usedDuplicates[Le])w.dump="*ref_"+Le;else{if(xe&&Re&&!w.usedDuplicates[Le]&&(w.usedDuplicates[Le]=!0),ae==="[object Object]")B&&Object.keys(w.dump).length!==0?(p(w,Y,w.dump,k),Re&&(w.dump="&ref_"+Le+w.dump)):(T(w,Y,w.dump),Re&&(w.dump="&ref_"+Le+" "+w.dump));else if(ae==="[object Array]")B&&w.dump.length!==0?(w.noArrayIndent&&!J&&Y>0?Ae(w,Y-1,w.dump,k):Ae(w,Y,w.dump,k),Re&&(w.dump="&ref_"+Le+w.dump)):(be(w,Y,w.dump),Re&&(w.dump="&ref_"+Le+" "+w.dump));else if(ae==="[object String]")w.tag!=="?"&&P(w,w.dump,Y,W,pe);else{if(ae==="[object Undefined]")return!1;if(w.skipInvalid)return!1;throw new i("unacceptable kind of an object to dump "+ae)}if(w.tag!==null&&w.tag!=="?"){let Ye=encodeURI(w.tag[0]==="!"?w.tag.slice(1):w.tag).replace(/!/g,"%21");w.tag[0]==="!"?Ye="!"+Ye:Ye.slice(0,18)==="tag:yaml.org,2002:"?Ye="!!"+Ye.slice(18):Ye="!<"+Ye+">",w.dump=Ye+" "+w.dump}}return!0}function te(w,Y){const N=[],B=[];q(w,N,B);const k=B.length;for(let W=0;W<k;W+=1)Y.duplicates.push(N[B[W]]);Y.usedDuplicates=new Array(k)}function q(w,Y,N){if(w!==null&&typeof w=="object"){const B=Y.indexOf(w);if(B!==-1)N.indexOf(B)===-1&&N.push(B);else if(Y.push(w),Array.isArray(w))for(let k=0,W=w.length;k<W;k+=1)q(w[k],Y,N);else{const k=Object.keys(w);for(let W=0,J=k.length;W<J;W+=1)q(w[k[W]],Y,N)}}}function ce(w,Y){Y=Y||{};const N=new ze(Y);N.noRefs||te(w,N);let B=w;return N.replacer&&(B=N.replacer.call({"":B},"",B)),ee(N,0,B,!0,!0)?N.dump+`
`:""}e.exports.dump=ce}),Wp=bS(wt((n,e)=>{var t=MS(),i=wS();function r(s,o){return function(){throw new Error("Function yaml."+s+" is removed in js-yaml 4. Use yaml."+o+" instead, which is now safe by default.")}}e.exports.Type=vn(),e.exports.Schema=Ap(),e.exports.FAILSAFE_SCHEMA=Lp(),e.exports.JSON_SCHEMA=Fp(),e.exports.CORE_SCHEMA=Op(),e.exports.DEFAULT_SCHEMA=Hu(),e.exports.load=t.load,e.exports.loadAll=t.loadAll,e.exports.dump=i.dump,e.exports.YAMLException=_o(),e.exports.types={binary:zp(),float:Up(),map:Rp(),null:Ip(),pairs:Vp(),set:Gp(),timestamp:Bp(),bool:Dp(),int:Np(),merge:kp(),omap:Hp(),seq:Pp(),str:Cp()},e.exports.safeLoad=r("safeLoad","load"),e.exports.safeLoadAll=r("safeLoadAll","loadAll"),e.exports.safeDump=r("safeDump","dump")})()),{Type:JE,Schema:QE,FAILSAFE_SCHEMA:eT,JSON_SCHEMA:tT,CORE_SCHEMA:nT,DEFAULT_SCHEMA:iT,load:Vu,loadAll:rT,dump:sT,YAMLException:oT,types:aT,safeLoad:lT,safeLoadAll:cT,safeDump:uT}=Wp.default;Wp.default;const ES={enabled:!0,min_triangle_area:1e-6,min_normal_dot:.05,min_angle_improvement_degrees:2,normal_error_weight:1,angle_quality_weight:1,material_error_weight:.25};function TS(n){const e=Vu(n);return{...e,polish:{...e.polish,diagonal_flip:{...ES,...e.polish?.diagonal_flip}}}}const AS=`# CLOD Pages — single source of truth (used by the Three.js PoC and the future Rust builder).\r
# See docs/plans/clod-execution-plan.md §1.\r
page:\r
  chunks_per_page: 4          # 4x4 chunks -> 64x64 cells footprint\r
  chunk_size: 16\r
  halo_chunks: 1              # generation halo for correct border normals\r
  quadtree_levels: 4          # LOD0..LOD3 (LOD3 page = 8x8 LOD0 pages footprint)\r
\r
simplify:                     # zeux demo/nanite.cpp parameters — start here, tune later\r
  target_ratio_per_level: 0.5     # 50% index count reduction per level\r
  abandon_ratio: 0.85             # if result > 85% of input, stop this branch\r
  target_error: 0.01              # meshopt relative error cap per pass\r
  weld_epsilon_cells: 0.001       # quantization for internal-seam welding\r
  # Phase 0 §2: attribute weights carried through simplification.\r
  # normals matter less than materials (triplanar splat seams).\r
  attribute_weights:\r
    normal: 0.5\r
    material: 1.0\r
\r
polish:\r
  diagonal_flip:\r
    enabled: true\r
    min_triangle_area: 0.000001\r
    min_normal_dot: 0.05\r
    min_angle_improvement_degrees: 2.0\r
    normal_error_weight: 1.0\r
    angle_quality_weight: 1.0\r
    material_error_weight: 0.25\r
\r
selection:\r
  error_threshold_px: 1.0\r
  hysteresis_merge_factor: 1.5    # merge at 1.5px, split at 1.0px\r
  neighbor_level_delta_max: 1     # 2:1 restricted quadtree constraint\r
  transition_mode: instant        # terrain pages swap atomically; dither is too noisy when textured\r
  crossfade_frames: 0\r
\r
near_field:\r
  radius_chunks: 6            # live editable Surface Nets bubble, no pages inside\r
\r
# Phase 0 §2 record: pinned npm package version validated by the PoC spike.\r
meshopt_package_version: "0.22.0"\r
`;function CS(n){const e=new Map;for(const t of n.nodesByLevel.values())for(const i of t)e.set(i.id,i);return e}function nu(n,e,t){return n.level=e.level,n.children=e.childIds.map(i=>i===null?null:t.get(i)??null),n.mesh=e.mesh,n.footprint=e.footprint,n.bounds=e.bounds,n.errorWorld=e.errorWorld,n.lowBenefit=e.lowBenefit,n}function PS(n){const e=new Map,t=new Map;for(const[i,r]of n.nodesByLevel){const s=r.map(o=>{const a={id:o.id,level:o.level,children:[],mesh:o.mesh,footprint:o.footprint,bounds:o.bounds,errorWorld:o.errorWorld,lowBenefit:o.lowBenefit};return e.set(a.id,a),a});t.set(i,s)}for(const[,i]of n.nodesByLevel)for(const r of i){const s=e.get(r.id);s&&nu(s,r,e)}return{roots:n.roots.map(i=>e.get(i)).filter(i=>!!i),nodesByLevel:t,stats:n.stats,worldPagesX:n.worldPagesX,worldPagesZ:n.worldPagesZ}}class RS{onParentRebuilt=null;onParentsComplete=null;onError=null;worker=new Worker(new URL("/drusniel-voxels-bevy/assets/clod_worker-ybfKcnPe.js",import.meta.url),{type:"module"});nextRequestId=1;result=null;nodesById=new Map;buildRequests=new Map;digRequests=new Map;flushRequests=new Map;progressHandlers=new Map;constructor(){this.worker.onmessage=e=>this.handleMessage(e.data),this.worker.onerror=e=>{const t=new Error(e.message||"CLOD worker failed");this.rejectAll(t),this.onError?.(t)}}buildWorld(e,t,i,r,s){const o=this.nextRequestId++,a={type:"build",requestId:o,worldPagesX:e,worldPagesZ:t,cfg:i,edits:r};return this.progressHandlers.set(o,s),new Promise((l,c)=>{this.buildRequests.set(o,{resolve:l,reject:c}),this.worker.postMessage(a)})}rebuildAfterDig(e,t){const i=this.nextRequestId++,r={type:"dig",requestId:i,edit:e,dirty:t};return new Promise((s,o)=>{this.digRequests.set(i,{resolve:s,reject:o}),this.worker.postMessage(r)})}flushParents(){const e=this.nextRequestId++,t={type:"flush",requestId:e};return new Promise((i,r)=>{this.flushRequests.set(e,{resolve:i,reject:r}),this.worker.postMessage(t)})}dispose(){this.worker.terminate(),this.rejectAll(new Error("CLOD worker disposed"))}handleMessage(e){switch(e.type){case"progress":this.progressHandlers.get(e.requestId)?.(e);break;case"buildComplete":{const t=this.buildRequests.get(e.requestId);if(!t)break;this.buildRequests.delete(e.requestId),this.progressHandlers.delete(e.requestId),this.result=PS(e.result),this.nodesById=CS(this.result),t.resolve(this.result);break}case"lod0Rebuilt":{const t=this.digRequests.get(e.requestId);if(!t)break;this.digRequests.delete(e.requestId);const i=e.changed.map(r=>{const s=this.nodesById.get(r.id);if(!s)throw new Error(`CLOD worker returned unknown node ${r.id}`);return nu(s,r,this.nodesById)});t.resolve({changed:i,dirtyCoords:e.dirtyCoords,lod0Pages:e.lod0Pages,lod0Ms:e.lod0Ms,chunksRemeshed:e.chunksRemeshed,chunksTotal:e.chunksTotal,pendingParents:e.pendingParents});break}case"parentRebuilt":this.onParentRebuilt?.(this.rehydrateParentBatch(e));break;case"parentsComplete":this.onParentsComplete?.(e.requestId,e.parentNodes,e.parentMs);break;case"flushed":{const t=this.flushRequests.get(e.requestId);if(!t)break;this.flushRequests.delete(e.requestId),t.resolve();break}case"error":this.handleError(e.requestId,new Error(e.message));break}}rehydrateParentBatch(e){return{requestId:e.requestId,changed:e.changed.map(t=>{const i=this.nodesById.get(t.id);if(!i)throw new Error(`CLOD worker returned unknown node ${t.id}`);return nu(i,t,this.nodesById)}),parentNodes:e.parentNodes,parentMs:e.parentMs,pendingParents:e.pendingParents}}handleError(e,t){if(e!==null){const i=this.buildRequests.get(e)??this.digRequests.get(e)??this.flushRequests.get(e);if(i){this.buildRequests.delete(e),this.digRequests.delete(e),this.flushRequests.delete(e),i.reject(t);return}}this.onError?.(t)}rejectAll(e){for(const t of this.buildRequests.values())t.reject(e);for(const t of this.digRequests.values())t.reject(e);for(const t of this.flushRequests.values())t.reject(e);this.buildRequests.clear(),this.digRequests.clear(),this.flushRequests.clear(),this.progressHandlers.clear()}}const LS=["ui.click","ui.hover","ui.error","ui.warning","ui.success","ui.toggle.on","ui.toggle.off","project.import.open","project.import.success","project.import.error","project.export.success","project.export.error","camera.mode.orbit","camera.mode.player","texture.dialog.open","texture.dialog.close","texture.slot.select","texture.load.open","texture.load.success","texture.load.error","material.paint","terrain.tool.select","terrain.dig.start","terrain.dig.tick","terrain.dig.stop","terrain.raise","terrain.lower","terrain.smooth","terrain.brush.radius","clod.rebuild.start","clod.rebuild.done","clod.rebuild.error","clod.validation.warning","clod.validation.error","clod.overlay.toggle","clod.selection.freeze.on","clod.selection.freeze.off","clod.lod.toggle","clod.wireframe.toggle","clod.locked-border.toggle","player.jump"],IS=`global:
  enabled: true
  master_volume: 0.55
  ui_volume: 0.60
  world_volume: 0.50
  debug_volume: 0.40

events:
  ui.click:
    enabled: true
    volume: 0.20
    cooldown_ms: 35
    synth: click
    pitch: 1400
    duration_ms: 50
  ui.hover:
    enabled: true
    volume: 0.08
    cooldown_ms: 50
    synth: soft_click
    pitch: 900
    duration_ms: 40
  ui.error:
    enabled: true
    volume: 0.25
    cooldown_ms: 100
    synth: error
    pitch: 220
    duration_ms: 150
  ui.warning:
    enabled: true
    volume: 0.20
    cooldown_ms: 100
    synth: warning
    pitch: 440
    duration_ms: 120
  ui.success:
    enabled: true
    volume: 0.25
    cooldown_ms: 100
    synth: success
    pitch: 523
    duration_ms: 250
  ui.toggle.on:
    enabled: true
    volume: 0.15
    cooldown_ms: 50
    synth: toggle_on
    pitch: 660
    duration_ms: 80
  ui.toggle.off:
    enabled: true
    volume: 0.15
    cooldown_ms: 50
    synth: toggle_off
    pitch: 660
    duration_ms: 80

  project.import.open:
    enabled: true
    volume: 0.15
    cooldown_ms: 100
    synth: click
    pitch: 1200
    duration_ms: 60
  project.import.success:
    enabled: true
    volume: 0.30
    cooldown_ms: 200
    synth: success
    pitch: 440
    duration_ms: 300
  project.import.error:
    enabled: true
    volume: 0.35
    cooldown_ms: 200
    synth: error
    pitch: 180
    duration_ms: 400
  project.export.success:
    enabled: true
    volume: 0.30
    cooldown_ms: 200
    synth: success
    pitch: 440
    duration_ms: 300
  project.export.error:
    enabled: true
    volume: 0.35
    cooldown_ms: 200
    synth: error
    pitch: 180
    duration_ms: 400

  camera.mode.orbit:
    enabled: true
    volume: 0.20
    cooldown_ms: 150
    synth: toggle_off
    pitch: 440
    duration_ms: 100
  camera.mode.player:
    enabled: true
    volume: 0.20
    cooldown_ms: 150
    synth: toggle_on
    pitch: 440
    duration_ms: 100

  texture.dialog.open:
    enabled: true
    volume: 0.18
    cooldown_ms: 150
    synth: soft_click
    pitch: 750
    duration_ms: 90
  texture.dialog.close:
    enabled: true
    volume: 0.15
    cooldown_ms: 150
    synth: soft_click
    pitch: 550
    duration_ms: 80
  texture.slot.select:
    enabled: true
    volume: 0.18
    cooldown_ms: 80
    synth: click
    pitch: 1100
    duration_ms: 50
  texture.load.open:
    enabled: true
    volume: 0.15
    cooldown_ms: 100
    synth: soft_click
    pitch: 800
    duration_ms: 70
  texture.load.success:
    enabled: true
    volume: 0.22
    cooldown_ms: 100
    synth: success
    pitch: 600
    duration_ms: 180
  texture.load.error:
    enabled: true
    volume: 0.28
    cooldown_ms: 100
    synth: error
    pitch: 200
    duration_ms: 250
  material.paint:
    enabled: true
    volume: 0.15
    cooldown_ms: 60
    synth: paint
    pitch: 500
    duration_ms: 80

  terrain.tool.select:
    enabled: true
    volume: 0.15
    cooldown_ms: 100
    synth: soft_click
    pitch: 1000
    duration_ms: 60
  terrain.dig.start:
    enabled: true
    volume: 0.10
    cooldown_ms: 100
    synth: soft_click
    pitch: 450
    duration_ms: 40
  terrain.dig.tick:
    enabled: true
    volume: 0.20
    cooldown_ms: 120
    synth: dig
    pitch: 180
    duration_ms: 100
  terrain.dig.stop:
    enabled: true
    volume: 0.08
    cooldown_ms: 100
    synth: soft_click
    pitch: 350
    duration_ms: 30
  terrain.raise:
    enabled: true
    volume: 0.22
    cooldown_ms: 120
    synth: raise
    pitch: 220
    duration_ms: 140
  terrain.lower:
    enabled: true
    volume: 0.22
    cooldown_ms: 120
    synth: lower
    pitch: 330
    duration_ms: 140
  terrain.smooth:
    enabled: true
    volume: 0.20
    cooldown_ms: 120
    synth: smooth
    pitch: 280
    duration_ms: 150
  terrain.brush.radius:
    enabled: true
    volume: 0.15
    cooldown_ms: 80
    synth: soft_click
    pitch: 1050
    duration_ms: 60

  clod.rebuild.start:
    enabled: true
    volume: 0.12
    cooldown_ms: 150
    synth: rebuild_start
    pitch: 480
    duration_ms: 70
  clod.rebuild.done:
    enabled: true
    volume: 0.18
    cooldown_ms: 150
    synth: rebuild_done
    pitch: 520
    duration_ms: 180
  clod.rebuild.error:
    enabled: true
    volume: 0.28
    cooldown_ms: 150
    synth: rebuild_error
    pitch: 150
    duration_ms: 350
  clod.validation.warning:
    enabled: true
    volume: 0.22
    cooldown_ms: 200
    synth: validation_warning
    pitch: 440
    duration_ms: 200
  clod.validation.error:
    enabled: true
    volume: 0.32
    cooldown_ms: 200
    synth: validation_error
    pitch: 180
    duration_ms: 400
  clod.overlay.toggle:
    enabled: true
    volume: 0.15
    cooldown_ms: 80
    synth: soft_click
    pitch: 950
    duration_ms: 60
  clod.selection.freeze.on:
    enabled: true
    volume: 0.18
    cooldown_ms: 100
    synth: toggle_on
    pitch: 580
    duration_ms: 100
  clod.selection.freeze.off:
    enabled: true
    volume: 0.18
    cooldown_ms: 100
    synth: toggle_off
    pitch: 580
    duration_ms: 100
  clod.lod.toggle:
    enabled: true
    volume: 0.15
    cooldown_ms: 80
    synth: soft_click
    pitch: 850
    duration_ms: 60
  clod.wireframe.toggle:
    enabled: true
    volume: 0.15
    cooldown_ms: 80
    synth: soft_click
    pitch: 900
    duration_ms: 60
  clod.locked-border.toggle:
    enabled: true
    volume: 0.15
    cooldown_ms: 80
    synth: soft_click
    pitch: 900
    duration_ms: 60
  player.jump:
    enabled: true
    volume: 0.12
    cooldown_ms: 250
    synth: jump
    pitch: 180
    duration_ms: 120

`;function DS(n){const e=Vu(n);if(!e||typeof e!="object")throw new Error("Invalid audio configuration");if(!e.global||typeof e.global!="object")throw new Error("Missing global audio configuration");if(!e.events||typeof e.events!="object")throw new Error("Missing events audio configuration");const t=[["enabled","boolean"],["volume","number"],["cooldown_ms","number"],["synth","string"],["pitch","number"],["duration_ms","number"]];for(const i of LS){const r=e.events[i];if(!r||typeof r!="object")throw new Error(`Missing audio config for event "${i}"`);for(const[s,o]of t)if(typeof r[s]!==o)throw new Error(`Event "${i}": field "${s}" should be ${o}, got ${typeof r[s]}`)}return e}const NS=DS(IS);class US{ctx=null;master=null;noiseBuf=null;enabled=!0;masterVol=.55;init(e){if(!this.ctx)try{if(this.ctx=e??new(window.AudioContext||window.webkitAudioContext),!this.ctx)return;this.master=this.ctx.createGain(),this.master.gain.value=this.masterVol,this.master.connect(this.ctx.destination);const t=this.ctx.sampleRate;this.noiseBuf=this.ctx.createBuffer(1,t,this.ctx.sampleRate);const i=this.noiseBuf.getChannelData(0);for(let r=0;r<t;r++)i[r]=Math.random()*2-1;this.ctx.state==="suspended"&&this.ctx.resume()}catch{this.ctx=null,this.master=null,this.noiseBuf=null}}setMasterVolume(e){this.masterVol=Math.min(1,Math.max(0,e)),this.master&&(this.master.gain.value=this.masterVol)}setEnabled(e){this.enabled=e}isEnabled(){return this.enabled}getMasterVolume(){return this.masterVol}isInitialized(){return this.ctx!==null}noise(e,t,i,r=.9,s="lowpass"){if(!(!this.enabled||!this.ctx||!this.master||!this.noiseBuf))try{const o=this.ctx.currentTime,a=this.ctx.createBufferSource();a.buffer=this.noiseBuf,a.playbackRate.value=.8+Math.random()*.4;const l=this.ctx.createBiquadFilter();l.type=s,l.frequency.value=t;const c=this.ctx.createGain();c.gain.setValueAtTime(i,o),c.gain.exponentialRampToValueAtTime(.001,o+e*r),a.connect(l).connect(c).connect(this.master),a.start(o,Math.random()*.5,e)}catch{}}tone(e,t,i,r="sine",s=0,o){if(!(!this.enabled||!this.ctx||!this.master))try{const a=this.ctx.currentTime+s,l=this.ctx.createOscillator();l.type=r,l.frequency.setValueAtTime(e,a),o&&l.frequency.exponentialRampToValueAtTime(o,a+t);const c=this.ctx.createGain();c.gain.setValueAtTime(0,a),c.gain.linearRampToValueAtTime(i,a+.01),c.gain.exponentialRampToValueAtTime(.001,a+t),l.connect(c).connect(this.master),l.start(a),l.stop(a+t+.05)}catch{}}playSynth(e,t,i,r,s){if(!this.ctx)return;this.ctx.state==="suspended"&&this.ctx.resume();const o=Math.min(1,Math.max(0,i!==void 0?i:t.volume)),a=r!==void 0?r:t.pitch,l=t.duration_ms/1e3,c=s!==void 0?s:0;switch(e){case"click":this.tone(a,l,o,"square");break;case"soft_click":this.tone(a,l,o,"sine");break;case"error":this.tone(a,l,o,"square",0,a*.7);break;case"warning":this.tone(a,l,o,"triangle");break;case"success":this.tone(a,l*.5,o,"triangle"),this.tone(a*1.33,l,o,"triangle",l*.4);break;case"toggle_on":this.tone(a,l,o,"sine",0,a*1.5);break;case"toggle_off":this.tone(a*1.5,l,o,"sine",0,a);break;case"texture_load":this.noise(l,2e3,o*.5,.7,"bandpass"),this.tone(a,l,o,"triangle",0,a*1.25);break;case"dig":this.noise(l,300+c*50,o,.8),this.tone(a-c*20,l,o*.5,"sawtooth",0,50);break;case"jump":this.tone(a,l,o,"triangle",0,a*1.35);break;case"raise":this.noise(l,500,o,.8),this.tone(a,l,o*.35,"triangle",0,a*1.5);break;case"lower":this.noise(l,350,o,.8),this.tone(a*1.5,l,o*.35,"triangle",0,a);break;case"smooth":this.noise(l,800,o,.9,"lowpass"),this.tone(a,l,o*.3,"sine");break;case"paint":this.noise(l,1500,o,.6,"bandpass");break;case"rebuild_start":this.tone(a,l,o,"sine",0,a*1.1);break;case"rebuild_done":this.tone(a,l,o,"sine"),this.tone(a*1.5,l,o*.8,"sine",.05);break;case"rebuild_error":this.tone(a,l,o,"square",0,a*.5),this.noise(l,400,o*.5);break;case"validation_warning":this.tone(a,l,o,"triangle"),this.tone(a,l,o,"triangle",l*.5);break;case"validation_error":this.tone(a,l,o,"square",0,a*.6),this.tone(a*.9,l,o,"square",.1,a*.5);break;default:this.tone(a,l,o,"sine");break}}}class FS{lastPlayed=new Map;isThrottled(e,t,i=!1){if(i)return this.lastPlayed.set(e,Date.now()),!1;const r=Date.now(),s=this.lastPlayed.get(e)??0,o=t.cooldown_ms;return r-s<o?!0:(this.lastPlayed.set(e,r),!1)}clear(){this.lastPlayed.clear()}}class OS{synthManager=new US;throttle=new FS;config=NS;constructor(){this.loadPersistence(),this.setupLazyInit()}loadPersistence(){if(!(typeof localStorage>"u"))try{const e=localStorage.getItem("clod_audio_enabled");e!==null?this.synthManager.setEnabled(e==="true"):this.synthManager.setEnabled(this.config.global.enabled);const t=localStorage.getItem("clod_audio_master_volume");t!==null?this.synthManager.setMasterVolume(parseFloat(t)):this.synthManager.setMasterVolume(this.config.global.master_volume)}catch{}}savePersistence(){if(!(typeof localStorage>"u"))try{localStorage.setItem("clod_audio_enabled",String(this.synthManager.isEnabled())),localStorage.setItem("clod_audio_master_volume",String(this.synthManager.getMasterVolume()))}catch{}}setupLazyInit(){if(typeof window>"u")return;const e=()=>{this.init(),t()},t=()=>{window.removeEventListener("pointerdown",e,{capture:!0}),window.removeEventListener("keydown",e,{capture:!0}),window.removeEventListener("click",e,{capture:!0})};window.addEventListener("pointerdown",e,{capture:!0,passive:!0}),window.addEventListener("keydown",e,{capture:!0,passive:!0}),window.addEventListener("click",e,{capture:!0,passive:!0})}init(e){this.synthManager.init(e)}emitAudio(e,t){if(this.synthManager.isInitialized()||this.init(),!this.synthManager.isEnabled())return;const i=this.config.events[e];if(!i){console.warn(`[audio] Unknown event ID: ${e}`);return}if(!i.enabled)return;const r=t?.force??!1;if(this.throttle.isThrottled(e,i,r))return;let s=1;e.startsWith("ui.")?s=this.config.global.ui_volume:e.startsWith("project.")||e.startsWith("camera.")||e.startsWith("texture.")||e.startsWith("material.")||e.startsWith("terrain.")?s=this.config.global.world_volume:e.startsWith("clod.")&&(s=this.config.global.debug_volume);let o=t?.volume!==void 0?t.volume:i.volume;const a=Math.min(1,Math.max(0,o*s));this.synthManager.playSynth(i.synth,i,a,t?.pitch,t?.variant)}setAudioEnabled(e){this.synthManager.setEnabled(e),this.savePersistence()}setMasterVolume(e){this.synthManager.setMasterVolume(e),this.savePersistence()}getAudioState(){return{enabled:this.synthManager.isEnabled(),masterVolume:this.synthManager.getMasterVolume(),initialized:this.synthManager.isInitialized()}}getConfig(){return this.config}}const qa=new OS,tt=(n,e)=>{qa.emitAudio(n,e)},BS=n=>{qa.setAudioEnabled(n)},kS=n=>{qa.setMasterVolume(n)},zh=()=>qa.getAudioState(),Hh=128,$p=18,Xp=$p-4,zS=Xp,HS=0,Gu={height:{min:14,max:118},continent:{scale:.001,amplitude:40,octaves:2,persistence:.5,lacunarity:2},mountains:{scale:.008,amplitude:120,octaves:7,persistence:.48,lacunarity:2.3,ridgePower:1.8,massifScale:.0035,massifAmplitude:38,massifThreshold:.38,massifPower:1.65},hills:{scale:.025,amplitude:25,octaves:4,persistence:.5,lacunarity:2},detail:{scale:.1,amplitude:3,octaves:3,persistence:.5,lacunarity:2}};function Ji(n,e,t=HS){let i=Math.imul(n|0,374761393)+Math.imul(e|0,668265263)+Math.imul(t|0,1376312589)|0;return i=Math.imul(i^i>>13,1274126177),((i^i>>16)>>>0)/4294967295}function ka(n){return n=Math.min(1,Math.max(0,n)),n*n*(3-2*n)}function Vh(n,e,t){const i=e-n;return Math.abs(i)<=Number.EPSILON?t>=e?1:0:ka((t-n)/i)}function jp(n,e){const t=Math.floor(n),i=Math.floor(e),r=ka(n-Math.floor(n)),s=ka(e-Math.floor(e)),o=Ji(t,i),a=Ji(t+1,i),l=Ji(t,i+1),c=Ji(t+1,i+1);return o+(a-o)*r+(l-o)*s+(o-a-l+c)*r*s}function Zr(n,e,t,i,r,s){let o=0,a=1,l=t,c=0;for(let u=0;u<i;u++)o+=a*jp(n*l,e*l),c+=a,a*=r,l*=s;return o/c}function VS(n,e){const t=Gu.mountains;let i=0,r=1,s=t.scale,o=0;for(let a=0;a<t.octaves;a++){const c=jp(n*s+a*100,e*s+a*100)*2-1,u=Math.pow(1-Math.abs(c),t.ridgePower);i+=u*r,o+=r,r*=t.persistence,s*=t.lacunarity}return i/o*t.amplitude}function GS(n,e){const t=Gu.mountains,i=Math.min(384,Math.max(128,1/Math.max(.001,t.massifScale))),r=Math.floor(n/i),s=Math.floor(e/i);let o=0;for(let a=-1;a<=1;a++)for(let l=-1;l<=1;l++){const c=r+l,u=s+a,d=Ji(Math.imul(c,43),Math.imul(u,59))-.5,h=Ji(Math.imul(c,71),Math.imul(u,37))-.5,f=.55+Ji(Math.imul(c,97),Math.imul(u,83))*.45,_=Ji(Math.imul(c,113),Math.imul(u,131)),v=(c+.5+d*.55)*i,g=(u+.5+h*.55)*i,m=i*(.42+_*.22),y=Math.hypot(n-v,e-g),S=Math.min(1,Math.max(0,1-y/Math.max(1,m))),M=Math.pow(ka(S),Math.max(.25,t.massifPower));o=Math.max(o,M*f)}return o}function WS(n,e,t){const i=Math.max(t-18,e),r=t-.5;if(n<=i||r<=i)return n;const s=r-i,o=n-i;return i+s*o/(o+s)}function Zi(n,e){const t=Gu,r=Zr(n,e,t.continent.scale,t.continent.octaves,t.continent.persistence,t.continent.lacunarity)*t.continent.amplitude*.55,s=Zr(n,e,t.mountains.scale*.25,2,.5,2),o=Zr(n+4096,e-2048,t.mountains.massifScale,3,.52,2),a=Math.max(Math.pow(Vh(t.mountains.massifThreshold,1,o),Math.max(.25,t.mountains.massifPower)),GS(n,e)),l=Math.pow(Math.min(1,Math.max(0,s)),1.35),c=Math.min(1,Math.max(0,l*.55+a*.8)),u=VS(n,e)*c*(1+a*.55),d=t.mountains.amplitude*.18*c+t.mountains.massifAmplitude*a,h=Zr(n+1375,e-911,t.continent.scale*2.2,3,.55,2),_=Vh(.22,.08,h)*14*(1-c*.75),g=Zr(n,e,t.hills.scale,t.hills.octaves,t.hills.persistence,t.hills.lacunarity)*t.hills.amplitude*.45,y=Zr(n,e,t.detail.scale,t.detail.octaves,t.detail.persistence,t.detail.lacunarity)*t.detail.amplitude,S=Math.max(t.height.min,Xp),M=zS+r+u+d+g+y-_;return Math.min(t.height.max-.5,Math.max(S,WS(M,S,t.height.max)))}const $S=1,mn=4,En=[];function XS(n){En.push({...n})}function Gh(){return En.map(n=>({...n}))}function jS(n){En.length=0;for(const e of n)En.push({...e})}function qS(){return En.length}function Wu(n,e,t,i,r,s){switch(n){case"cube":{const o=Math.abs(e)-r,a=Math.abs(t)-s,l=Math.abs(i)-r;return Math.hypot(Math.max(o,0),Math.max(a,0),Math.max(l,0))+Math.min(Math.max(o,a,l),0)}case"cylinder":{const o=Math.hypot(e,i)-r,a=Math.abs(t)-s;return Math.hypot(Math.max(o,0),Math.max(a,0))+Math.min(Math.max(o,a),0)}default:return Math.hypot(e,t*r/s,i)-r}}function Ya(n){return n.height??n.r}function Ei(n,e,t){let i=Zi(n,t)-e;if(En.length>0&&e>$S)for(const r of En){const s=Ya(r),o=r.r+mn,a=s+mn,l=n-r.x,c=e-r.y,u=t-r.z;if(Math.abs(l)>o||Math.abs(c)>a||Math.abs(u)>o)continue;const d=Wu(r.shape,l,c,u,r.r,s),h=r.op==="add"?Math.max(i,-d):Math.min(i,d),f=Math.max(.001,(r.falloff??0)*r.r),_=Math.min(1,Math.max(0,-d/f))*(r.strength??1);i+=(h-i)*_}return i}function qp(n,e,t){const r=Ei(n+.5,e,t)-Ei(n-.5,e,t),s=Ei(n,e+.5,t)-Ei(n,e-.5,t),o=Ei(n,e,t+.5)-Ei(n,e,t-.5),a=-r,l=-s,c=-o,u=Math.hypot(a,l,c)||1;return[a/u,l/u,c/u]}function YS(n,e){return qp(n,Zi(n,e),e)}function ZS(n,e){const t=Math.max(0,1-Math.abs(n-$p)/6),i=Math.max(0,(n-88)/22),r=Math.max(0,Math.min(1,(n-48)/34))*(1-i),s=Math.max(0,1-t-i-r),o=t+i+r+s||1;return[s/o,r/o,t/o,i/o]}const iu=.75;function KS(n,e,t){if(En.length>0)for(let i=En.length-1;i>=0;i--){const r=En[i];if(r.op!=="add")continue;const s=Ya(r),o=r.r+mn,a=s+mn,l=n-r.x,c=e-r.y,u=t-r.z;if(!(Math.abs(l)>o||Math.abs(c)>a||Math.abs(u)>o)&&Wu(r.shape,l,c,u,r.r,s)<=iu)return Math.max(0,(r.material??0)|0)+1}return 0}const ai=4,Wh=3;function JS(n,e,t){const i=new Array(ai).fill(-1),r=new Array(ai).fill(0);if(En.length===0)return{slots:i,weights:r};const s=new Map;for(let a=En.length-1;a>=0;a--){const l=En[a];if(l.op!=="add")continue;const c=Ya(l),u=l.r+mn,d=c+mn,h=n-l.x,f=e-l.y,_=t-l.z;if(Math.abs(h)>u||Math.abs(f)>d||Math.abs(_)>u)continue;const v=Wu(l.shape,h,f,_,l.r,c);if(v>=Wh)continue;const g=Math.min(Math.max((v-iu)/(Wh-iu),0),1),m=1-g*g*(3-2*g);if(m<=0)continue;const y=Math.max(0,(l.material??0)|0);s.set(y,Math.max(s.get(y)??0,m))}const o=[...s.keys()].sort((a,l)=>a-l).slice(0,ai);for(let a=0;a<o.length;a++)i[a]=o[a],r[a]=s.get(o[a]);return{slots:i,weights:r}}const QS={x:[[0,-1,-1],[0,0,-1],[0,0,0],[0,-1,0]],y:[[-1,0,-1],[-1,0,0],[0,0,0],[0,0,-1]],z:[[-1,-1,0],[0,-1,0],[0,0,0],[-1,0,0]]};function eM(n,e,t){return((n+512)*2048+(e+512))*2048+(t+512)}function tM(n,e,t){const i=[];let r=0;for(let u=0;u<8;u++){const d=n+(u&1),h=e+(u>>1&1),f=t+(u>>2&1),_=Ei(d,h,f);i.push(_),_<0&&r++}if(r===0||r===8)return null;const s=[[0,1],[2,3],[4,5],[6,7],[0,2],[1,3],[4,6],[5,7],[0,4],[1,5],[2,6],[3,7]];let o=0,a=0,l=0,c=0;for(const[u,d]of s){const h=i[u],f=i[d];if(h<0==f<0)continue;const _=h/(h-f),v=n+(u&1),g=e+(u>>1&1),m=t+(u>>2&1),y=n+(d&1),S=e+(d>>1&1),M=t+(d>>2&1);o+=v+(y-v)*_,a+=g+(S-g)*_,l+=m+(M-m)*_,c++}return[o/c,a/c,l/c]}function nM(n,e,t,i){const r=eM(e,t,i),s=n.index.get(r);if(s!==void 0)return s;const o=tM(e,t,i);if(o===null)return null;const[a,l,c]=o,[u,d,h]=qp(a,l,c),f=KS(a,l,c),_=n.pos.length/3;return n.pos.push(a,l,c),n.nrm.push(u,d,h),n.mat.push(f),n.index.set(r,_),_}function iM(n,e,t,i){const r=t.page.chunk_size,s={pos:[],nrm:[],mat:[],index:new Map},o=[],a=n*r,l=(n+1)*r,c=e*r,u=(e+1)*r,d=En.filter(h=>h.x+h.r+mn>=a-1&&h.x-h.r-mn<=l&&h.z+h.r+mn>=c-1&&h.z-h.r-mn<=u);for(let h=a;h<l;h++)for(let f=c;f<u;f++){const _=[Zi(h,f),Zi(h+1,f),Zi(h-1,f),Zi(h,f+1),Zi(h,f-1)];let v=Math.max(0,Math.floor(Math.min(..._))-2),g=Math.min(Hh-1,Math.ceil(Math.max(..._))+2);for(const m of d){if(Math.abs(h-m.x)>m.r+mn||Math.abs(f-m.z)>m.r+mn)continue;const y=Ya(m);v=Math.max(0,Math.min(v,Math.floor(m.y-y-mn))),g=Math.min(Hh-1,Math.max(g,Math.ceil(m.y+y+mn)))}for(let m=v;m<=g;m++)jl("x",h,m,f,s,o,i),jl("y",h,m,f,s,o,i),jl("z",h,m,f,s,o,i)}return{positions:new Float32Array(s.pos),normals:new Float32Array(s.nrm),materials:new Float32Array(s.mat),indices:new Uint32Array(o)}}function jl(n,e,t,i,r,s,o){const a=Ei(e,t,i),l=n==="x"?e+1:e,c=n==="y"?t+1:t,u=n==="z"?i+1:i,d=Ei(l,c,u);if(a<0==d<0)return;const h=QS[n];for(const[v,,g]of h){const m=e+v,y=i+g;if(m<0||m>=o.cellsX||y<0||y>=o.cellsZ)return}const f=[];for(const[v,g,m]of h){const y=nM(r,e+v,t+g,i+m);if(y===null)return;f.push(y)}a<d?s.push(f[0],f[2],f[1],f[0],f[3],f[2]):s.push(f[0],f[1],f[2],f[0],f[2],f[3])}function $s(n){return/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(n)}const rM=[{id:"air",name:"Air",kind:"system",colorRgb:[0,0,0],strength:0,transparent:!0},{id:"top-soil",name:"Top Soil",kind:"organic",colorRgb:[85,128,43],strength:1,walkable:!0,diggable:!0,paintable:!0},{id:"sub-soil",name:"Sub Soil",kind:"terrain",colorRgb:[120,80,50],strength:1.2,walkable:!0,diggable:!0,paintable:!0},{id:"rock",name:"Rock",kind:"rock",colorRgb:[128,128,128],strength:5,walkable:!0,diggable:!0,paintable:!0},{id:"bedrock",name:"Bedrock",kind:"rock",colorRgb:[64,64,64],strength:100,walkable:!0,diggable:!1,paintable:!1},{id:"sand",name:"Sand",kind:"terrain",colorRgb:[220,200,140],strength:.8,walkable:!0,diggable:!0,paintable:!0},{id:"clay",name:"Clay",kind:"terrain",colorRgb:[180,110,80],strength:1.5,walkable:!0,diggable:!0,paintable:!0},{id:"water",name:"Water",kind:"water",colorRgb:[0,100,200],strength:.1,walkable:!0,diggable:!1,paintable:!1,transparent:!0},{id:"snow",name:"Snow",kind:"organic",colorRgb:[240,240,250],strength:.5,walkable:!0,diggable:!0,paintable:!0},{id:"lava",name:"Lava",kind:"terrain",colorRgb:[255,60,0],strength:10,walkable:!1,diggable:!1,paintable:!1},{id:"debug-error",name:"Debug Error",kind:"debug",colorRgb:[255,0,255],strength:0},{id:"debug-locked-border",name:"Debug Locked Border",kind:"debug",colorRgb:[255,255,0],strength:0}],sM=[{id:"natural",name:"Natural",slotIndex:0,source:"builtin",tags:["terrain"]},{id:"grass-top",name:"Grass Top",slotIndex:1,source:"builtin",materialId:"top-soil",tags:["organic"]},{id:"dirt",name:"Dirt",slotIndex:2,source:"builtin",materialId:"sub-soil",tags:["terrain"]},{id:"rock",name:"Rock",slotIndex:3,source:"builtin",materialId:"rock",tags:["rock"]},{id:"sand",name:"Sand",slotIndex:4,source:"builtin",materialId:"sand",tags:["terrain"]},{id:"water",name:"Water",slotIndex:5,source:"builtin",materialId:"water",tags:["water"]},{id:"snow",name:"Snow",slotIndex:6,source:"builtin",materialId:"snow",tags:["organic"]},{id:"lava",name:"Lava",slotIndex:7,source:"builtin",materialId:"lava",tags:["terrain"]}],oM=[{id:"test-plain",name:"Test Plain",defaultMaterialId:"top-soil",waterMaterialId:"water",tags:["plain"],terrainBands:[{id:"plain-low",name:"Plain Low",minHeight:-50,maxHeight:10,materialId:"sand",textureSlotId:"sand"},{id:"plain-mid",name:"Plain Mid",minHeight:10,maxHeight:100,materialId:"top-soil",textureSlotId:"grass-top"}]},{id:"rocky-hills",name:"Rocky Hills",defaultMaterialId:"sub-soil",waterMaterialId:"water",tags:["hills"],terrainBands:[{id:"hills-low",name:"Hills Low",minHeight:-50,maxHeight:30,materialId:"sub-soil",textureSlotId:"dirt"},{id:"hills-high",name:"Hills High",minHeight:30,maxHeight:200,materialId:"rock",textureSlotId:"rock"}]},{id:"lake-basin",name:"Lake Basin",defaultMaterialId:"clay",waterMaterialId:"water",tags:["basin"],terrainBands:[{id:"basin-floor",name:"Basin Floor",minHeight:-100,maxHeight:-10,materialId:"clay",textureSlotId:"dirt"},{id:"basin-shore",name:"Basin Shore",minHeight:-10,maxHeight:5,materialId:"sand",textureSlotId:"sand"},{id:"basin-bank",name:"Basin Bank",minHeight:5,maxHeight:50,materialId:"top-soil",textureSlotId:"grass-top"}]},{id:"snow-peak",name:"Snow Peak",defaultMaterialId:"rock",waterMaterialId:"water",tags:["mountain"],terrainBands:[{id:"peak-lower",name:"Peak Lower",minHeight:0,maxHeight:80,materialId:"rock",textureSlotId:"rock"},{id:"peak-upper",name:"Peak Upper",minHeight:80,maxHeight:500,materialId:"snow",textureSlotId:"snow"}]}],aM=[{id:"default",name:"Default View",showWireframe:!1,showPageBoundaries:!1,showLockedBorders:!1,showNodeLabels:!1,colorByLod:!1,errorPx:2},{id:"seam-debug",name:"Seam Debug",showWireframe:!0,showPageBoundaries:!0,showLockedBorders:!1,showNodeLabels:!0,colorByLod:!1,errorPx:1.5},{id:"locked-border-debug",name:"Locked Border Debug",showWireframe:!0,showPageBoundaries:!1,showLockedBorders:!0,showNodeLabels:!1,colorByLod:!1,errorPx:2},{id:"performance",name:"Performance View",showWireframe:!1,showPageBoundaries:!1,showLockedBorders:!1,showNodeLabels:!1,colorByLod:!0,errorPx:4},{id:"validation",name:"Validation View",showWireframe:!0,showPageBoundaries:!0,showLockedBorders:!0,showNodeLabels:!0,colorByLod:!0,errorPx:1}],lM=[{id:"wood-floor",name:"Wood Floor",category:"floor",dimensions:[4,.2,4],canGround:!0,materialId:"top-soil",snapPoints:[{id:"north",localOffset:[0,0,-2],direction:[0,0,-1],group:"floor-edge",compatibleGroups:["floor-edge"]},{id:"south",localOffset:[0,0,2],direction:[0,0,1],group:"floor-edge",compatibleGroups:["floor-edge"]},{id:"east",localOffset:[2,0,0],direction:[1,0,0],group:"floor-edge",compatibleGroups:["floor-edge"]},{id:"west",localOffset:[-2,0,0],direction:[-1,0,0],group:"floor-edge",compatibleGroups:["floor-edge"]}]},{id:"wood-wall",name:"Wood Wall",category:"wall",dimensions:[4,3,.2],canGround:!1,materialId:"sub-soil",snapPoints:[{id:"bottom",localOffset:[0,-1.5,0],direction:[0,-1,0],group:"wall-bottom",compatibleGroups:["floor-edge"]},{id:"top",localOffset:[0,1.5,0],direction:[0,1,0],group:"wall-top",compatibleGroups:["wall-bottom"]}]},{id:"stone-floor",name:"Stone Floor",category:"floor",dimensions:[4,.4,4],canGround:!0,materialId:"rock",snapPoints:[{id:"north",localOffset:[0,0,-2],direction:[0,0,-1],group:"floor-edge",compatibleGroups:["floor-edge"]},{id:"south",localOffset:[0,0,2],direction:[0,0,1],group:"floor-edge",compatibleGroups:["floor-edge"]}]},{id:"stone-wall",name:"Stone Wall",category:"wall",dimensions:[4,4,.4],canGround:!0,materialId:"rock",snapPoints:[{id:"bottom",localOffset:[0,-2,0],direction:[0,-1,0],group:"wall-bottom",compatibleGroups:["floor-edge"]}]},{id:"debug-column",name:"Debug Column",category:"pillar",dimensions:[.5,4,.5],canGround:!0,snapPoints:[{id:"center-bottom",localOffset:[0,-2,0],direction:[0,-1,0],group:"generic",compatibleGroups:["generic"]}]}],$h=`- id: air
  name: Air
  kind: system
  colorRgb: [0, 0, 0]
  strength: 0.0
  transparent: true

- id: top-soil
  name: Top Soil
  kind: organic
  colorRgb: [85, 128, 43]
  strength: 1.0
  walkable: true
  diggable: true
  paintable: true

- id: sub-soil
  name: Sub Soil
  kind: terrain
  colorRgb: [120, 80, 50]
  strength: 1.2
  walkable: true
  diggable: true
  paintable: true

- id: rock
  name: Rock
  kind: rock
  colorRgb: [128, 128, 128]
  strength: 5.0
  walkable: true
  diggable: true
  paintable: true

- id: bedrock
  name: Bedrock
  kind: rock
  colorRgb: [64, 64, 64]
  strength: 100.0
  walkable: true
  diggable: false
  paintable: false

- id: sand
  name: Sand
  kind: terrain
  colorRgb: [220, 200, 140]
  strength: 0.8
  walkable: true
  diggable: true
  paintable: true

- id: clay
  name: Clay
  kind: terrain
  colorRgb: [180, 110, 80]
  strength: 1.5
  walkable: true
  diggable: true
  paintable: true

- id: water
  name: Water
  kind: water
  colorRgb: [0, 100, 200]
  strength: 0.1
  walkable: true
  diggable: false
  paintable: false
  transparent: true

- id: snow
  name: Snow
  kind: organic
  colorRgb: [240, 240, 250]
  strength: 0.5
  walkable: true
  diggable: true
  paintable: true

- id: lava
  name: Lava
  kind: terrain
  colorRgb: [255, 60, 0]
  strength: 10.0
  walkable: false
  diggable: false
  paintable: false

- id: debug-error
  name: Debug Error
  kind: debug
  colorRgb: [255, 0, 255]
  strength: 0.0

- id: debug-locked-border
  name: Debug Locked Border
  kind: debug
  colorRgb: [255, 255, 0]
  strength: 0.0
`,Xh=`- id: natural
  name: Natural
  slotIndex: 0
  source: builtin
  tags: [terrain]

- id: grass-top
  name: Grass Top
  slotIndex: 1
  source: builtin
  materialId: top-soil
  tags: [organic]

- id: dirt
  name: Dirt
  slotIndex: 2
  source: builtin
  materialId: sub-soil
  tags: [terrain]

- id: rock
  name: Rock
  slotIndex: 3
  source: builtin
  materialId: rock
  tags: [rock]

- id: sand
  name: Sand
  slotIndex: 4
  source: builtin
  materialId: sand
  tags: [terrain]

- id: water
  name: Water
  slotIndex: 5
  source: builtin
  materialId: water
  tags: [water]

- id: snow
  name: Snow
  slotIndex: 6
  source: builtin
  materialId: snow
  tags: [organic]

- id: lava
  name: Lava
  slotIndex: 7
  source: builtin
  materialId: lava
  tags: [terrain]
`,jh=`- id: test-plain
  name: Test Plain
  defaultMaterialId: top-soil
  waterMaterialId: water
  tags: [plain]
  terrainBands:
    - id: plain-low
      name: Plain Low
      minHeight: -50
      maxHeight: 10
      materialId: sand
      textureSlotId: sand
    - id: plain-mid
      name: Plain Mid
      minHeight: 10
      maxHeight: 100
      materialId: top-soil
      textureSlotId: grass-top

- id: rocky-hills
  name: Rocky Hills
  defaultMaterialId: sub-soil
  waterMaterialId: water
  tags: [hills]
  terrainBands:
    - id: hills-low
      name: Hills Low
      minHeight: -50
      maxHeight: 30
      materialId: sub-soil
      textureSlotId: dirt
    - id: hills-high
      name: Hills High
      minHeight: 30
      maxHeight: 200
      materialId: rock
      textureSlotId: rock

- id: lake-basin
  name: Lake Basin
  defaultMaterialId: clay
  waterMaterialId: water
  tags: [basin]
  terrainBands:
    - id: basin-floor
      name: Basin Floor
      minHeight: -100
      maxHeight: -10
      materialId: clay
      textureSlotId: dirt
    - id: basin-shore
      name: Basin Shore
      minHeight: -10
      maxHeight: 5
      materialId: sand
      textureSlotId: sand
    - id: basin-bank
      name: Basin Bank
      minHeight: 5
      maxHeight: 50
      materialId: top-soil
      textureSlotId: grass-top

- id: snow-peak
  name: Snow Peak
  defaultMaterialId: rock
  waterMaterialId: water
  tags: [mountain]
  terrainBands:
    - id: peak-lower
      name: Peak Lower
      minHeight: 0
      maxHeight: 80
      materialId: rock
      textureSlotId: rock
    - id: peak-upper
      name: Peak Upper
      minHeight: 80
      maxHeight: 500
      materialId: snow
      textureSlotId: snow
`,qh=`- id: default
  name: Default View
  showWireframe: false
  showPageBoundaries: false
  showLockedBorders: false
  showNodeLabels: false
  colorByLod: false
  errorPx: 2.0

- id: seam-debug
  name: Seam Debug
  showWireframe: true
  showPageBoundaries: true
  showLockedBorders: false
  showNodeLabels: true
  colorByLod: false
  errorPx: 1.5

- id: locked-border-debug
  name: Locked Border Debug
  showWireframe: true
  showPageBoundaries: false
  showLockedBorders: true
  showNodeLabels: false
  colorByLod: false
  errorPx: 2.0

- id: performance
  name: Performance View
  showWireframe: false
  showPageBoundaries: false
  showLockedBorders: false
  showNodeLabels: false
  colorByLod: true
  errorPx: 4.0

- id: validation
  name: Validation View
  showWireframe: true
  showPageBoundaries: true
  showLockedBorders: true
  showNodeLabels: true
  colorByLod: true
  errorPx: 1.0
`,Yh=`- id: wood-floor
  name: Wood Floor
  category: floor
  dimensions: [4.0, 0.2, 4.0]
  canGround: true
  materialId: top-soil
  snapPoints:
    - id: north
      localOffset: [0.0, 0.0, -2.0]
      direction: [0.0, 0.0, -1.0]
      group: floor-edge
      compatibleGroups: [floor-edge]
    - id: south
      localOffset: [0.0, 0.0, 2.0]
      direction: [0.0, 0.0, 1.0]
      group: floor-edge
      compatibleGroups: [floor-edge]
    - id: east
      localOffset: [2.0, 0.0, 0.0]
      direction: [1.0, 0.0, 0.0]
      group: floor-edge
      compatibleGroups: [floor-edge]
    - id: west
      localOffset: [-2.0, 0.0, 0.0]
      direction: [-1.0, 0.0, 0.0]
      group: floor-edge
      compatibleGroups: [floor-edge]

- id: wood-wall
  name: Wood Wall
  category: wall
  dimensions: [4.0, 3.0, 0.2]
  canGround: false
  materialId: sub-soil
  snapPoints:
    - id: bottom
      localOffset: [0.0, -1.5, 0.0]
      direction: [0.0, -1.0, 0.0]
      group: wall-bottom
      compatibleGroups: [floor-edge]
    - id: top
      localOffset: [0.0, 1.5, 0.0]
      direction: [0.0, 1.0, 0.0]
      group: wall-top
      compatibleGroups: [wall-bottom]

- id: stone-floor
  name: Stone Floor
  category: floor
  dimensions: [4.0, 0.4, 4.0]
  canGround: true
  materialId: rock
  snapPoints:
    - id: north
      localOffset: [0.0, 0.0, -2.0]
      direction: [0.0, 0.0, -1.0]
      group: floor-edge
      compatibleGroups: [floor-edge]
    - id: south
      localOffset: [0.0, 0.0, 2.0]
      direction: [0.0, 0.0, 1.0]
      group: floor-edge
      compatibleGroups: [floor-edge]

- id: stone-wall
  name: Stone Wall
  category: wall
  dimensions: [4.0, 4.0, 0.4]
  canGround: true
  materialId: rock
  snapPoints:
    - id: bottom
      localOffset: [0.0, -2.0, 0.0]
      direction: [0.0, -1.0, 0.0]
      group: wall-bottom
      compatibleGroups: [floor-edge]

- id: debug-column
  name: Debug Column
  category: pillar
  dimensions: [0.5, 4.0, 0.5]
  canGround: true
  snapPoints:
    - id: center-bottom
      localOffset: [0.0, -2.0, 0.0]
      direction: [0.0, -1.0, 0.0]
      group: generic
      compatibleGroups: [generic]
`;let ru,su,ou;if(typeof window>"u"&&typeof process<"u"&&process.versions?.node)try{const n=await lo(()=>import("./__vite-browser-external-BIHI7g3E.js"),[]),e=await lo(()=>import("./__vite-browser-external-BIHI7g3E.js"),[]);ru=n.readFileSync,su=n.existsSync,ou=e.join}catch{}function cM(n){const e=n?.strict??!1,t=[];let i=$h,r=Xh,s=jh,o=qh,a=Yh;const l=n?.rootDir||"config/content";if(typeof window>"u"&&ru&&su&&ou){const R=(A,C)=>{const D=ou(l,A);if(su(D))try{return ru(D,"utf8")}catch($){if(e)throw new Error(`Failed to read file ${D}: ${$}`);return console.warn(`[ContentRegistry] Warning: Failed to read ${D}. Falling back to default.`),t.push({severity:"warning",code:"LOAD_FILE_FAILED",path:D,message:`Failed to read file: ${$ instanceof Error?$.message:String($)}`}),C}else{if(e)throw new Error(`Required file ${D} is missing.`);return console.warn(`[ContentRegistry] Warning: ${D} not found. Falling back to default.`),t.push({severity:"warning",code:"FILE_MISSING",path:D,message:"File not found on disk."}),C}};i=R("materials.yaml",$h),r=R("texture_slots.yaml",Xh),s=R("biomes.yaml",jh),o=R("clod_debug_presets.yaml",qh),a=R("snap_pieces.yaml",Yh)}const c=(R,A,C)=>{try{const D=Vu(R);if(!D||typeof D!="object")throw new Error("Parsed YAML is not an array or object");return D}catch(D){if(e)throw new Error(`YAML syntax error in ${C}: ${D instanceof Error?D.message:String(D)}`);return console.warn(`[ContentRegistry] Warning: Failed to parse YAML for ${C}. Falling back to defaults.`),t.push({severity:"error",code:"YAML_PARSE_ERROR",path:C,message:`YAML syntax error: ${D instanceof Error?D.message:String(D)}`}),A}},u=c(i,rM,"materials"),d=c(r,sM,"texture_slots"),h=c(s,oM,"biomes"),f=c(o,aM,"clod_debug_presets"),_=c(a,lM,"snap_pieces"),v=(R,A)=>{const C=new Map;if(Array.isArray(R))for(let D=0;D<R.length;D++){const $=R[D];$&&typeof $=="object"?typeof $.id=="string"&&$.id.trim()!==""?(C.has($.id)&&t.push({severity:"error",code:"DUPLICATE_ID",path:`${A}.${$.id}`,message:`Duplicate ID "${$.id}" found in ${A}.`}),C.set($.id,$)):t.push({severity:"error",code:"INVALID_ENTRY",path:`${A}[${D}]`,message:'Entry is missing a valid string "id".'}):t.push({severity:"error",code:"INVALID_ENTRY",path:`${A}[${D}]`,message:"Entry is not a valid object."})}else t.push({severity:"error",code:"INVALID_CATEGORY_FORMAT",path:A,message:`${A} content YAML must define a list of entries.`});return C},g=v(u,"materials"),m=v(d,"texture_slots"),y=v(h,"biomes"),S=v(f,"clod_debug_presets"),M=v(_,"snap_pieces");return{materials:g,textureSlots:m,biomes:y,clodDebugPresets:S,snapPieces:M,_errors:t.length>0?t:void 0}}const uM=["claudecraft","quest","mob","npc","dungeon","loot","leveling","xp","mana","class","spell","alliance","horde","raid","boss"],Zh=new Set(["floor-edge","wall-bottom","wall-top","wall-side","roof-edge","generic"]);function dM(n,e){const t=e?.strict??!1,i=[];n._errors&&i.push(...n._errors);function r(l,c){if(typeof l=="string"){const u=l.toLowerCase();for(const d of uM)u.includes(d)&&i.push({severity:"error",code:"BANNED_TERM",path:c,message:`Value "${l}" contains banned MMO/World of Claudecraft term "${d}".`})}else if(Array.isArray(l))for(let u=0;u<l.length;u++)r(l[u],`${c}[${u}]`);else if(l instanceof Map)for(const[u,d]of l.entries())r(u,`${c}.key(${u})`),r(d,`${c}.${u}`);else if(l&&typeof l=="object")for(const u of Object.keys(l))u!=="_errors"&&r(l[u],`${c}.${u}`)}r(n,"registry");for(const[l,c]of n.materials.entries()){const u=`materials.${l}`;$s(l)||i.push({severity:"error",code:"INVALID_ID_FORMAT",path:u,message:`Material ID "${l}" must be lowercase kebab-case.`});const d=c.colorRgb;(!Array.isArray(d)||d.length!==3||d.some(h=>!Number.isInteger(h)||h<0||h>255))&&i.push({severity:"error",code:"INVALID_COLOR_RGB",path:`${u}.colorRgb`,message:`Material "${l}" colorRgb must be [R, G, B] integers in 0..255.`}),c.strength!==void 0&&(typeof c.strength!="number"||!Number.isFinite(c.strength)||c.strength<0)&&i.push({severity:"error",code:"INVALID_STRENGTH",path:`${u}.strength`,message:`Material "${l}" strength must be a finite number >= 0.`}),c.transparent&&c.diggable&&!c.allowTransparentDigging&&i.push({severity:"error",code:"TRANSPARENT_DIGGABLE",path:u,message:`Material "${l}" is transparent and diggable, which is not allowed unless allowTransparentDigging is true.`}),c.kind==="water"&&!c.transparent&&i.push({severity:"error",code:"WATER_MUST_BE_TRANSPARENT",path:`${u}.transparent`,message:`Material "${l}" is of kind water but is not transparent.`})}const s=new Map;for(const[l,c]of n.textureSlots.entries()){const u=`textureSlots.${l}`;$s(l)||i.push({severity:"error",code:"INVALID_ID_FORMAT",path:u,message:`Texture slot ID "${l}" must be lowercase kebab-case.`}),c.materialId&&!n.materials.has(c.materialId)&&i.push({severity:"error",code:"MISSING_MATERIAL_REF",path:`${u}.materialId`,message:`Texture slot "${l}" references missing material "${c.materialId}".`}),(!Number.isInteger(c.slotIndex)||c.slotIndex<0)&&i.push({severity:"error",code:"INVALID_SLOT_INDEX",path:`${u}.slotIndex`,message:`Texture slot "${l}" slotIndex must be a non-negative integer, got ${c.slotIndex}.`}),c.alias||(s.has(c.slotIndex)?i.push({severity:"error",code:"DUPLICATE_SLOT_INDEX",path:`${u}.slotIndex`,message:`Texture slot "${l}" shares slotIndex ${c.slotIndex} with "${s.get(c.slotIndex)}" but is not marked as alias.`}):s.set(c.slotIndex,l))}for(const[l,c]of n.biomes.entries()){const u=`biomes.${l}`;if($s(l)||i.push({severity:"error",code:"INVALID_ID_FORMAT",path:u,message:`Biome ID "${l}" must be lowercase kebab-case.`}),n.materials.has(c.defaultMaterialId)||i.push({severity:"error",code:"MISSING_MATERIAL_REF",path:`${u}.defaultMaterialId`,message:`Biome "${l}" defaultMaterialId references missing material "${c.defaultMaterialId}".`}),c.waterMaterialId){const f=n.materials.get(c.waterMaterialId);f?f.kind!=="water"&&!f.transparent&&i.push({severity:"error",code:"INVALID_WATER_MATERIAL",path:`${u}.waterMaterialId`,message:`Biome "${l}" waterMaterialId "${c.waterMaterialId}" must point to a water or transparent material.`}):i.push({severity:"error",code:"MISSING_MATERIAL_REF",path:`${u}.waterMaterialId`,message:`Biome "${l}" waterMaterialId references missing material "${c.waterMaterialId}".`})}const d=c.terrainBands||[],h=[...d].sort((f,_)=>f.minHeight-_.minHeight);for(let f=0;f<d.length;f++){const _=d[f],v=`${u}.terrainBands[${f}]`;n.materials.has(_.materialId)||i.push({severity:"error",code:"MISSING_MATERIAL_REF",path:`${v}.materialId`,message:`Terrain band "${_.id}" in biome "${l}" references missing material "${_.materialId}".`}),n.textureSlots.has(_.textureSlotId)||i.push({severity:"error",code:"MISSING_TEXTURE_SLOT_REF",path:`${v}.textureSlotId`,message:`Terrain band "${_.id}" in biome "${l}" references missing texture slot "${_.textureSlotId}".`}),_.minHeight>=_.maxHeight&&i.push({severity:"error",code:"INVALID_HEIGHT_RANGE",path:v,message:`Terrain band "${_.id}" in biome "${l}" has invalid height range [${_.minHeight}, ${_.maxHeight}].`})}for(let f=0;f<d.length;f++)for(let _=f+1;_<d.length;_++){const v=d[f],g=d[_];v.minHeight<g.maxHeight&&g.minHeight<v.maxHeight&&i.push({severity:"error",code:"OVERLAPPING_TERRAIN_BANDS",path:`${u}.terrainBands`,message:`Terrain bands "${v.id}" and "${g.id}" in biome "${l}" overlap.`})}for(let f=0;f<h.length-1;f++)if(h[f].maxHeight<h[f+1].minHeight){const _=t?"error":"warning";i.push({severity:_,code:"TERRAIN_BAND_GAP",path:`${u}.terrainBands`,message:`Terrain bands in biome "${l}" leave a height gap between ${h[f].maxHeight} and ${h[f+1].minHeight}.`})}}for(const[l,c]of n.clodDebugPresets.entries()){const u=`clodDebugPresets.${l}`;$s(l)||i.push({severity:"error",code:"INVALID_ID_FORMAT",path:u,message:`Debug preset ID "${l}" must be lowercase kebab-case.`}),(c.errorPx===void 0||typeof c.errorPx!="number"||!Number.isFinite(c.errorPx)||c.errorPx<=0)&&i.push({severity:"error",code:"INVALID_ERROR_PX",path:`${u}.errorPx`,message:`Debug preset "${l}" errorPx must be a finite number > 0.`})}for(const[l,c]of n.snapPieces.entries()){const u=`snapPieces.${l}`;$s(l)||i.push({severity:"error",code:"INVALID_ID_FORMAT",path:u,message:`Snap piece ID "${l}" must be lowercase kebab-case.`});const d=c.dimensions;(!Array.isArray(d)||d.length!==3||d.some(f=>typeof f!="number"||!Number.isFinite(f)||f<=0))&&i.push({severity:"error",code:"INVALID_SNAP_PIECE_DIMENSIONS",path:`${u}.dimensions`,message:`Snap piece "${l}" dimensions must be 3 positive finite numbers.`}),c.materialId&&!n.materials.has(c.materialId)&&i.push({severity:"error",code:"MISSING_MATERIAL_REF",path:`${u}.materialId`,message:`Snap piece "${l}" references missing material "${c.materialId}".`});const h=c.snapPoints||[];for(let f=0;f<h.length;f++){const _=h[f],v=`${u}.snapPoints[${f}]`,g=_.direction;if(!Array.isArray(g)||g.length!==3||g.some(m=>typeof m!="number"||!Number.isFinite(m)))i.push({severity:"error",code:"INVALID_SNAP_POINT_DIRECTION",path:`${v}.direction`,message:`Snap point "${_.id}" in snap piece "${l}" direction must be 3 finite numbers.`});else{const m=Math.sqrt(g[0]*g[0]+g[1]*g[1]+g[2]*g[2]);m<1e-6&&i.push({severity:"error",code:"UNNORMALIZABLE_DIRECTION",path:`${v}.direction`,message:`Snap point "${_.id}" in snap piece "${l}" direction vector is too close to zero (magnitude ${m}).`})}if(Zh.has(_.group)||i.push({severity:"error",code:"UNKNOWN_SNAP_GROUP",path:`${v}.group`,message:`Snap point "${_.id}" has unknown group "${_.group}".`}),Array.isArray(_.compatibleGroups))for(let m=0;m<_.compatibleGroups.length;m++){const y=_.compatibleGroups[m];Zh.has(y)||i.push({severity:"error",code:"UNKNOWN_COMPATIBLE_SNAP_GROUP",path:`${v}.compatibleGroups[${m}]`,message:`Snap point "${_.id}" compatibleGroups contains unknown group "${y}".`})}}}const o=i.filter(l=>l.severity==="error"),a=i.filter(l=>l.severity==="warning");return{ok:o.length===0,errors:o,warnings:a}}const rn=16,ql=4,hM=["low","mid low","mid high","high"];function Kr(n){return hM[n]??`Material ${n+1}`}function Yl(){return{texture:null,normalTexture:null,normalPreviewUrl:null,normalBytes:null,normalMimeType:null,normalExtension:null,name:"empty",previewUrl:null,selectedId:"",customBytes:null,customMimeType:null,customExtension:null,scale:1/64,heightMin:0,heightMax:0}}function $u(n,e){return Array.from({length:n},(t,i)=>e(i)).join(`
`)}function fM(){return"  uniform sampler2DArray uTerrainAlbedoArray;"}function pM(){return"  uniform sampler2DArray uTerrainNormalArray;"}function mM(){const n=["vec3(0.42, 0.58, 0.30)","vec3(0.55, 0.52, 0.50)","vec3(0.85, 0.78, 0.55)","vec3(0.96, 0.97, 1.00)","vec3(0.62, 0.48, 0.36)","vec3(0.72, 0.70, 0.68)","vec3(0.38, 0.52, 0.44)","vec3(0.78, 0.74, 0.62)","vec3(0.50, 0.56, 0.64)","vec3(0.66, 0.58, 0.52)","vec3(0.44, 0.46, 0.50)","vec3(0.58, 0.62, 0.48)","vec3(0.74, 0.66, 0.58)","vec3(0.52, 0.44, 0.40)","vec3(0.68, 0.72, 0.76)","vec3(0.82, 0.80, 0.74)"];return`  vec3 paintFallbackColor(int slot) {
${$u(rn,t=>`    if (slot == ${t}) return ${n[t]??n[t%4]};`)}
    return vec3(0.0);
  }`}function gM(){return`  vec3 sampleTextureSlot(int slot, vec3 worldPos) {
    return triplanarSample(float(slot), worldPos, uTextureScales[slot]);
  }`}function _M(){return`  vec3 sampleNormalSlot(int slot, vec3 worldPos, vec3 baseN) {
    return uNormalMapMask[slot] > 0.5 ? triplanarNormal(float(slot), worldPos, uTextureScales[slot], baseN) : baseN;
  }`}function vM(){return`  vec3 sampleTerrainNormal(vec3 worldPos, vec3 baseN) {
    float height = worldPos.y;
    vec3 acc = vec3(0.0);
    float wsum = 0.0;
${$u(rn,e=>{const t=e===0?"":`    if (uTerrainTextureCount <= ${e}) return normalize(acc / wsum);
`,i=e===0?"    float w = rangeWeight(height, uTextureRanges[0]);":`    w = uTerrainTextureCount > ${e} ? rangeWeight(height, uTextureRanges[${e}]) : 0.0;`;return`${t}    vec3 n${e} = sampleNormalSlot(${e}, worldPos, baseN);
${i}
    acc += n${e} * w;
    wsum += w;`})}
    if (wsum > 0.0) return normalize(acc / wsum);
    return baseN;
  }`}function yM(){return`  vec3 sampleTerrainTexture(vec3 worldPos) {
    float height = worldPos.y;
    vec3 acc = vec3(0.0);
    float wsum = 0.0;
${$u(rn,e=>{const t=e===0?"":`    if (uTerrainTextureCount <= ${e}) {
      if (wsum > 0.0) return acc / wsum;
      return nearest;
    }
`,i=e===0?"    float w = rangeWeight(height, uTextureRanges[0]);":`    w = uTerrainTextureCount > ${e} ? rangeWeight(height, uTextureRanges[${e}]) : 0.0;`,r=e===0?`    vec3 nearest = t0;
    float best = centerDistance(height, uTextureRanges[0]);`:`    if (uTerrainTextureCount > ${e} && centerDistance(height, uTextureRanges[${e}]) < best) {
      nearest = t${e};
      best = centerDistance(height, uTextureRanges[${e}]);
    }`;return`${t}    vec3 t${e} = sampleTextureSlot(${e}, worldPos);
${i}
    acc += t${e} * w;
    wsum += w;
${r}`})}
    if (wsum > 0.0) return acc / wsum;
    return nearest;
  }`}const Yp=["x","y","z","w"];function xM(){return`  vec3 blendPaintedAlbedo(vec3 worldPos) {
    vec3 acc = vec3(0.0);
    float wsum = 0.0;
${Yp.map(e=>`    if (vPaintWeights.${e} > 0.0 && vPaintSlots.${e} > -0.5) {
      acc += sampleTextureSlot(int(vPaintSlots.${e} + 0.5), worldPos) * vPaintWeights.${e};
      wsum += vPaintWeights.${e};
    }`).join(`
`)}
    return wsum > 0.0 ? acc / wsum : vec3(0.0);
  }`}function bM(){return`  vec3 blendPaintedFallback() {
    vec3 acc = vec3(0.0);
    float wsum = 0.0;
${Yp.map(e=>`    if (vPaintWeights.${e} > 0.0 && vPaintSlots.${e} > -0.5) {
      acc += paintFallbackColor(int(vPaintSlots.${e} + 0.5)) * vPaintWeights.${e};
      wsum += vPaintWeights.${e};
    }`).join(`
`)}
    return wsum > 0.0 ? acc / wsum : vec3(0.0);
  }`}function SM(){return`
  precision highp float;
  uniform vec3 uColor;
  uniform vec3 uLight;
  uniform vec3 uSunColor;
  uniform vec3 uSkyLight;
  uniform vec3 uGroundLight;
  uniform float uFade;
  uniform bool uDither;
  uniform bool uFadeIn;
  uniform bool uNormalColor;
  uniform bool uNormalDivergence;
  uniform float uDivergenceGain;
  uniform float uBrightness;
  uniform float uContrast;
  uniform float uSaturation;
  uniform float uWarmth;
  uniform bool uUseTexture;
  uniform bool uUseTriplanar;
  uniform int uTerrainTextureCount;
${fM()}
  uniform bool uUseNormalMap;
  uniform float uNormalIntensity;
  uniform float uRoughness;
  uniform float uMetalness;
  uniform float uNormalMapMask[${rn}];
${pM()}
  uniform float uTextureScales[${rn}];
  uniform bool uTextureBlendBands;
  uniform float uTextureBlendWidth;
  uniform vec2 uTextureRanges[${rn}];
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  varying vec4 vPaintSlots;
  varying vec4 vPaintWeights;

${mM()}

  float ign(vec2 p) {
    return fract(52.9829189 * fract(0.06711056 * p.x + 0.00583715 * p.y));
  }
  float rangeWeight(float height, vec2 range) {
    if (!uTextureBlendBands) {
      return step(range.x, height) * step(height, range.y);
    }
    float width = max(uTextureBlendWidth, 0.0001);
    float aboveLow = smoothstep(range.x - width, range.x + width, height);
    float belowHigh = 1.0 - smoothstep(range.y - width, range.y + width, height);
    return aboveLow * belowHigh;
  }
  float centerDistance(float height, vec2 range) {
    return abs(height - (range.x + range.y) * 0.5);
  }
  vec3 triplanarWeights(vec3 worldNormal) {
    vec3 a = abs(worldNormal);
    vec3 w = vec3(pow(a.x, 4.0), pow(a.y, 4.0), pow(a.z, 4.0));
    return w / max(w.x + w.y + w.z, 0.001);
  }
  vec3 triplanarSample(float layer, vec3 worldPos, float scale) {
    if (!uUseTriplanar) {
      return texture(uTerrainAlbedoArray, vec3(worldPos.xz * scale, layer)).rgb;
    }
    vec3 w = triplanarWeights(normalize(vWorldNormal));
    vec3 cy = texture(uTerrainAlbedoArray, vec3(worldPos.yz * scale, layer)).rgb;
    vec3 cz = texture(uTerrainAlbedoArray, vec3(worldPos.xz * scale, layer)).rgb;
    vec3 cx = texture(uTerrainAlbedoArray, vec3(worldPos.xy * scale, layer)).rgb;
    return cy * w.x + cz * w.y + cx * w.z;
  }
  vec3 unpackNormalMap(vec3 s) { return normalize(s * 2.0 - 1.0); }
  vec3 reorientNormal(vec3 tn, vec3 wn, int axis) {
    vec3 n = normalize(vec3(tn.xy * uNormalIntensity, tn.z));
    if (axis == 0) return normalize(vec3(n.z * sign(wn.x), n.y, n.x));
    if (axis == 1) return normalize(vec3(n.x, n.z * sign(wn.y), n.y));
    return normalize(vec3(n.x, n.y, n.z * sign(wn.z)));
  }
  vec3 triplanarNormal(float layer, vec3 worldPos, float scale, vec3 wn) {
    vec3 w = triplanarWeights(wn);
    vec3 n0 = reorientNormal(unpackNormalMap(texture(uTerrainNormalArray, vec3(worldPos.yz * scale, layer)).rgb), wn, 0);
    vec3 n1 = reorientNormal(unpackNormalMap(texture(uTerrainNormalArray, vec3(worldPos.xz * scale, layer)).rgb), wn, 1);
    vec3 n2 = reorientNormal(unpackNormalMap(texture(uTerrainNormalArray, vec3(worldPos.xy * scale, layer)).rgb), wn, 2);
    return normalize(n0 * w.x + n1 * w.y + n2 * w.z);
  }
${gM()}
${_M()}
${vM()}
${yM()}
${xM()}
${bM()}
  vec3 adjustColor(vec3 color) {
    color *= uBrightness;
    color = (color - 0.5) * uContrast + 0.5;
    float luma = dot(color, vec3(0.299, 0.587, 0.114));
    color = mix(vec3(luma), color, uSaturation);
    vec3 warm = vec3(1.0 + uWarmth * 0.16, 1.0 + uWarmth * 0.05, 1.0 - uWarmth * 0.12);
    color *= warm;
    return max(color, vec3(0.0));
  }
  void main() {
    if (uDither) {
      float n = ign(gl_FragCoord.xy);
      if (uFadeIn) {
        if (n > uFade) discard;
      } else {
        if (n <= 1.0 - uFade) discard;
      }
    }
    if (uNormalDivergence) {
      vec3 gN = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));
      float div = 1.0 - abs(dot(normalize(vWorldNormal), gN));
      gl_FragColor = vec4(vec3(div * uDivergenceGain), 1.0);
      return;
    }
    if (uNormalColor) {
      gl_FragColor = vec4(normalize(vWorldNormal) * 0.5 + 0.5, 1.0);
      return;
    }
    vec3 n = normalize(vWorldNormal);
    if (uUseNormalMap && uTerrainTextureCount > 0) {
      n = sampleTerrainNormal(vWorldPos, n);
    }
    float sun = max(dot(n, normalize(uLight)), 0.0);
    float sky = clamp(n.y * 0.5 + 0.5, 0.0, 1.0);
    float paint = clamp(dot(vPaintWeights, vec4(1.0)), 0.0, 1.0);
    vec3 baseColor = uColor;
    if (uUseTexture) {
      vec3 tex = sampleTerrainTexture(vWorldPos);
      if (paint > 0.0) {
        tex = mix(tex, blendPaintedAlbedo(vWorldPos), paint);
      }
      baseColor = tex * mix(vec3(1.0), uColor, 0.35);
    } else if (paint > 0.0) {
      baseColor = mix(uColor, blendPaintedFallback(), paint);
    }
    baseColor = adjustColor(baseColor);
    vec3 hemi = mix(uGroundLight, uSkyLight, sky);
    vec3 light = hemi + uSunColor * pow(sun, 1.35);
    float rough = clamp(uRoughness, 0.04, 1.0);
    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    vec3 halfVec = normalize(normalize(uLight) + viewDir);
    float shininess = mix(128.0, 4.0, rough);
    float spec = pow(max(dot(n, halfVec), 0.0), shininess) * (1.0 - rough) * sun;
    vec3 specColor = mix(vec3(1.0), baseColor, uMetalness);
    vec3 diffuse = baseColor * light * (1.0 - 0.85 * uMetalness);
    gl_FragColor = vec4(diffuse + uSunColor * spec * specColor, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`}function MM(){return{uColor:{value:new Ke(12173512)},uLight:{value:new z(-.35,.82,.45).normalize()},uSunColor:{value:new Ke(.95,.86,.68)},uSkyLight:{value:new Ke(.42,.48,.58)},uGroundLight:{value:new Ke(.18,.16,.13)},uFade:{value:1},uDither:{value:!1},uFadeIn:{value:!0},uNormalColor:{value:!1},uNormalDivergence:{value:!1},uDivergenceGain:{value:8},uBrightness:{value:1},uContrast:{value:1},uSaturation:{value:1},uWarmth:{value:0},uUseTexture:{value:!1},uUseTriplanar:{value:!0},uTerrainTextureCount:{value:0},uUseNormalMap:{value:!1},uNormalIntensity:{value:1},uRoughness:{value:.9},uMetalness:{value:0},uNormalMapMask:{value:new Float32Array(rn)},uTextureScales:{value:new Float32Array(rn).fill(.015625)},uTextureBlendBands:{value:!1},uTextureBlendWidth:{value:6},uTextureRanges:{value:Array.from({length:rn},()=>new Xe(0,0))},uTerrainAlbedoArray:{value:null},uTerrainNormalArray:{value:null}}}function Kh(n,e,t){n.uniforms.uUseTexture.value=t.enabled,n.uniforms.uUseTriplanar.value=t.triplanar,n.uniforms.uUseNormalMap.value=t.normalMap,n.uniforms.uNormalIntensity.value=t.normalIntensity,n.uniforms.uRoughness.value=t.roughness,n.uniforms.uMetalness.value=t.metalness,n.uniforms.uTerrainTextureCount.value=e.length,n.uniforms.uTextureBlendBands.value=t.blendBands,n.uniforms.uTextureBlendWidth.value=t.blendWidth,n.uniforms.uTerrainAlbedoArray.value=t.albedoArray,n.uniforms.uTerrainNormalArray.value=t.normalArray;const i=n.uniforms.uTextureScales.value,r=n.uniforms.uNormalMapMask.value;for(let s=0;s<rn;s++){const o=e[s];i[s]=(o?.scale??1/64)*t.textureScale,r[s]=o?.normalTexture?1:0,n.uniforms.uTextureRanges.value[s].set(o?.heightMin??0,o?.heightMax??0)}}const Wi={brightness:1,contrast:1,saturation:1,warmth:0},wM=`
  attribute vec4 paintSlots;
  attribute vec4 paintWeights;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  varying vec4 vPaintSlots;
  varying vec4 vPaintWeights;
  void main() {
    vWorldPos = position;
    vWorldNormal = normal;
    vPaintSlots = paintSlots;
    vPaintWeights = paintWeights;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;function Jh(n){const e=new Dn({uniforms:MM(),vertexShader:wM,fragmentShader:SM(),side:en,toneMapped:!0});return e.uniforms.uColor.value=new Ke(n),e}function Zl(n,e){n.uniforms.uBrightness.value=e.brightness,n.uniforms.uContrast.value=e.contrast,n.uniforms.uSaturation.value=e.saturation,n.uniforms.uWarmth.value=e.warmth}const Qh=Math.PI*2,EM=.05,ef=[[0,1],[.35,.75],[.7,.4],[1,0]],TM=`
  uniform float uTime;
  uniform float uBladeWidth;
  uniform float uWindStrength;
  uniform float uWindSpeed;
  attribute vec3 aOffset;
  attribute float aHeight;
  attribute float aRotY;
  attribute float aPhase;
  attribute float aColorMix;
  varying vec2 vUv;
  varying float vColorMix;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;

  void main() {
    float bend = uv.y * uv.y;
    float windTime = uTime * uWindSpeed + aPhase + aOffset.x * 0.071 + aOffset.z * 0.053;
    vec2 wind = vec2(sin(windTime), cos(windTime * 0.83 + aPhase * 0.37));
    wind *= uWindStrength * aHeight * bend;

    vec3 localPosition = vec3(position.x * uBladeWidth, position.y * aHeight, position.z);
    localPosition.xz += wind;

    float c = cos(aRotY);
    float s = sin(aRotY);
    vec3 rotatedPosition = vec3(
      c * localPosition.x + s * localPosition.z,
      localPosition.y,
      -s * localPosition.x + c * localPosition.z
    );
    vec3 localNormal = normalize(vec3(-wind.x * 0.35, bend * 0.16, 1.0 - wind.y * 0.35));
    vWorldNormal = normalize(vec3(
      c * localNormal.x + s * localNormal.z,
      localNormal.y,
      -s * localNormal.x + c * localNormal.z
    ));
    vWorldPos = aOffset + rotatedPosition;
    vUv = uv;
    vColorMix = aColorMix;
    gl_Position = projectionMatrix * viewMatrix * vec4(vWorldPos, 1.0);
  }
`,AM=`
  precision highp float;
  uniform vec3 uLight;
  uniform vec3 uSunColor;
  uniform vec3 uSkyLight;
  uniform vec3 uGroundLight;
  varying vec2 vUv;
  varying float vColorMix;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;

  void main() {
    vec3 darkGreen = vec3(0.035, 0.12, 0.025);
    vec3 midGreen = vec3(0.12, 0.34, 0.055);
    vec3 tipGreen = vec3(0.34, 0.56, 0.12);
    vec3 dryGrass = vec3(0.52, 0.42, 0.12);
    vec3 grassColor = mix(darkGreen, midGreen, smoothstep(0.0, 0.62, vUv.y));
    grassColor = mix(grassColor, tipGreen, smoothstep(0.58, 1.0, vUv.y));
    grassColor = mix(grassColor, dryGrass, vColorMix * 0.58);

    vec3 n = normalize(vWorldNormal);
    if (!gl_FrontFacing) n = -n;
    vec3 lightDirection = normalize(uLight);
    float sun = max(dot(n, lightDirection), 0.0);
    float back = max(dot(-n, lightDirection), 0.0);
    float sky = clamp(n.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 hemi = mix(uGroundLight, uSkyLight, sky);
    vec3 direct = uSunColor * pow(sun, 1.25);
    vec3 transmission = vec3(0.46, 0.55, 0.12) * back * (0.16 + vUv.y * 0.5);
    gl_FragColor = vec4(grassColor * (hemi + direct) + transmission * grassColor, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`,Fn={distance:96,bladeSpacing:1.6,bladeHeight:1.15,bladeHeightVariation:.75,bladeWidth:.08,windStrength:.32,windSpeed:1.35,slopeMinY:.72,minHeight:20,maxHeight:86,maxBlades:35e3,seed:1337};function cs(n,e,t){let i=t|0;return i^=Math.imul(n|0,668265261),i^=Math.imul(e|0,374761393),i=Math.imul(i^i>>>15,2246822507),i=Math.imul(i^i>>>13,3266489909),((i^i>>>16)>>>0)/4294967296}function Kl(n,e,t){return cs(n,e,t)*2-1}function CM(n,e){return e.normalY>=n.slopeMinY&&e.height>=n.minHeight&&e.height<=n.maxHeight&&e.grassWeight>EM&&e.threshold<e.grassWeight}function PM(n,e,t=e.maxBlades){const i=[],r=Math.max(.05,e.bladeSpacing),s=Math.max(0,Math.floor((n.maxX-n.minX)/r)),o=Math.max(0,Math.floor((n.maxZ-n.minZ)/r)),a=Math.max(0,Math.floor(t));for(let l=0;l<o;l++)for(let c=0;c<s;c++){const u=Math.floor(n.minX/r)+c,d=Math.floor(n.minZ/r)+l,h=n.minX+(c+.5)*r,f=n.minZ+(l+.5)*r,_=Nt.clamp(h+Kl(u,d,e.seed+101)*r*.34,n.minX+.001,n.maxX-.001),v=Nt.clamp(f+Kl(u,d,e.seed+211)*r*.34,n.minZ+.001,n.maxZ-.001),g=Zi(_,v),m=YS(_,v)[1],y=ZS(g)[0];if(!CM(e,{height:g,normalY:m,grassWeight:y,threshold:cs(u,d,e.seed+307)}))continue;const S=Math.max(.1,1+Kl(u,d,e.seed+401)*e.bladeHeightVariation);i.push({priority:cs(u,d,e.seed+809),instance:{offset:[_,g+.02,v],height:e.bladeHeight*S,rotationY:cs(u,d,e.seed+503)*Qh,phase:cs(u,d,e.seed+601)*Qh,colorMix:Math.pow(cs(u,d,e.seed+701),2)}})}return i.sort((l,c)=>l.priority-c.priority),i.slice(0,a).map(({instance:l})=>l)}function RM(){const n=[],e=[],t=[];for(const[r,s]of ef)n.push(-s,r,0,s,r,0),e.push(0,r,1,r);for(let r=0;r<ef.length-1;r++){const s=r*2,o=s+2;t.push(s,s+1,o+1,s,o+1,o)}const i=new Ct;return i.setAttribute("position",new Ft(n,3)),i.setAttribute("uv",new Ft(e,2)),i.setIndex(t),i}function LM(n,e){return new Dn({uniforms:{uTime:{value:0},uBladeWidth:{value:n.bladeWidth},uWindStrength:{value:n.windStrength},uWindSpeed:{value:n.windSpeed},uLight:{value:e.light.clone()},uSunColor:{value:e.sunColor.clone()},uSkyLight:{value:e.skyLight.clone()},uGroundLight:{value:e.groundLight.clone()}},vertexShader:TM,fragmentShader:AM,side:en,transparent:!1,depthWrite:!0,toneMapped:!0})}class IM{scene;nodes;worldCells;root=new Pi;bladeGeometry=RM();material;settings;patches=[];bladeCount=0;lastCenter;constructor(e){this.scene=e.scene,this.nodes=e.nodes.filter(t=>t.level===0).sort((t,i)=>t.footprint.minZ-i.footprint.minZ||t.footprint.minX-i.footprint.minX),this.worldCells=e.worldCells,this.settings={...e.settings},this.material=LM(this.settings,e.lighting),this.lastCenter=new z(this.worldCells*.5,0,this.worldCells*.5),this.root.name="grass",this.scene.add(this.root),this.root.visible=this.settings.enabled,this.settings.enabled&&this.rebuild()}setEnabled(e){const t=this.settings.enabled;this.settings.enabled=e,this.root.visible=e,e&&!t&&this.patches.length===0&&this.refreshPatches(this.lastCenter)}updateSettings(e){Object.assign(this.settings,e),this.material.uniforms.uBladeWidth.value=this.settings.bladeWidth,this.material.uniforms.uWindStrength.value=this.settings.windStrength,this.material.uniforms.uWindSpeed.value=this.settings.windSpeed,this.setEnabled(this.settings.enabled)}updateLighting(e){this.material.uniforms.uLight.value.copy(e.light),this.material.uniforms.uSunColor.value.copy(e.sunColor),this.material.uniforms.uSkyLight.value.copy(e.skyLight),this.material.uniforms.uGroundLight.value.copy(e.groundLight)}update(e,t){if(this.material.uniforms.uTime.value=e,this.lastCenter.copy(t),!!this.settings.enabled){this.refreshPatches(t);for(const i of this.patches){const r=Math.hypot(t.x-i.centerX,t.z-i.centerZ);i.mesh.visible=r<=this.settings.distance+i.radius}}}rebuild(){this.clearPatches(),this.settings.enabled&&this.refreshPatches(this.lastCenter),this.root.visible=this.settings.enabled}rebuildNodePatches(e){const t=new Set(e);if(t.size===0)return;const i=[];for(const r of this.patches)t.has(r.nodeId)?(this.root.remove(r.mesh),r.mesh.geometry.dispose(),this.bladeCount-=r.bladeCount):i.push(r);this.patches=i,this.refreshPatches(this.lastCenter)}dispose(){this.clearPatches(),this.root.clear(),this.scene.remove(this.root),this.bladeGeometry.dispose(),this.material.dispose()}getBladeCount(){return this.bladeCount}clearPatches(){for(const e of this.patches)this.root.remove(e.mesh),e.mesh.geometry.dispose();this.patches=[],this.bladeCount=0}refreshPatches(e){const t=this.nodes.filter(l=>{const c=l.footprint,u=(c.minX+c.maxX)*.5,d=(c.minZ+c.maxZ)*.5,h=Math.hypot(c.maxX-c.minX,c.maxZ-c.minZ)*.5;return Math.hypot(e.x-u,e.z-d)<=this.settings.distance+h}),i=new Set(t.map(l=>l.id)),r=[];for(const l of this.patches)i.has(l.nodeId)?r.push(l):(this.root.remove(l.mesh),l.mesh.geometry.dispose(),this.bladeCount-=l.bladeCount);this.patches=r;const s=new Set(this.patches.map(l=>l.nodeId)),o=t.filter(l=>!s.has(l.id));let a=Math.max(0,Math.floor(this.settings.maxBlades)-this.bladeCount);for(let l=0;l<o.length&&a>0;l++){const c=o[l],u=c.footprint,d={minX:Nt.clamp(u.minX,0,this.worldCells),minZ:Nt.clamp(u.minZ,0,this.worldCells),maxX:Nt.clamp(u.maxX,0,this.worldCells),maxZ:Nt.clamp(u.maxZ,0,this.worldCells)},h=o.length-l,f=Math.ceil(a/h),_=PM(d,this.settings,f);if(_.length===0)continue;const v=this.createPatch(c.id,d,_);this.patches.push(v),this.root.add(v.mesh),this.bladeCount+=v.bladeCount,a-=v.bladeCount}}createPatch(e,t,i){const r=new Pb;r.setAttribute("position",this.bladeGeometry.getAttribute("position")),r.setAttribute("uv",this.bladeGeometry.getAttribute("uv")),r.setIndex(this.bladeGeometry.getIndex());const s=new Float32Array(i.length*3),o=new Float32Array(i.length),a=new Float32Array(i.length),l=new Float32Array(i.length),c=new Float32Array(i.length);let u=Number.POSITIVE_INFINITY,d=Number.NEGATIVE_INFINITY;for(let g=0;g<i.length;g++){const m=i[g];s.set(m.offset,g*3),o[g]=m.height,a[g]=m.rotationY,l[g]=m.phase,c[g]=m.colorMix,u=Math.min(u,m.offset[1]),d=Math.max(d,m.offset[1]+m.height)}r.setAttribute("aOffset",new Gs(s,3)),r.setAttribute("aHeight",new Gs(o,1)),r.setAttribute("aRotY",new Gs(a,1)),r.setAttribute("aPhase",new Gs(l,1)),r.setAttribute("aColorMix",new Gs(c,1)),r.instanceCount=i.length;const h=this.settings.bladeWidth+this.settings.bladeHeight*(1+this.settings.bladeHeightVariation)*this.settings.windStrength;r.boundingBox=new $t(new z(t.minX-h,u,t.minZ-h),new z(t.maxX+h,d,t.maxZ+h)),r.boundingSphere=r.boundingBox.getBoundingSphere(new As);const f=(t.minX+t.maxX)*.5,_=(t.minZ+t.maxZ)*.5,v=Math.hypot(t.maxX-t.minX,t.maxZ-t.minZ)*.5;return{nodeId:e,mesh:new gn(r,this.material),centerX:f,centerZ:_,radius:v,bladeCount:i.length}}}const za=Object.freeze({walkSpeed:8,runSpeed:16,jumpHeight:4,capsuleRadius:.45,capsuleHeight:1.8,eyeHeight:1.7,maxSlopeDegrees:60,worldEdgeMargin:16,gravity:30,fixedStep:1/120,recoveryDepth:32,groundAcceleration:60,airAcceleration:16,coyoteTime:.12,jumpBufferTime:.15});class DM{mode="orbit";chooseSpawn(){this.mode="choosingSpawn"}startPlaying(){this.mode="playing"}exitToOrbit(){this.mode="orbit"}}function NM(n,e=za){const t=new Xe(n.right,n.forward);return t.lengthSq()>1&&t.normalize(),{direction:t,speed:n.sprint?e.runSpeed:e.walkSpeed,jump:n.jump}}function UM(n,e){return Math.sqrt(2*e*n)}function tf(n,e,t){return n.x=Nt.clamp(n.x,e.minX+t,e.maxX-t),n.z=Nt.clamp(n.z,e.minZ+t,e.maxZ-t),n}class FM{constructor(e,t,i=za){this.colliders=e,this.bounds=t,this.config=i}position=new z;velocity=new z;lastSafePosition=new z;grounded=!1;lastPhysicsMs=0;lastPagesTested=0;accumulator=0;coyoteTimer=0;jumpBufferTimer=0;physicsSamples=[];spawn(e){this.position.copy(e).addScaledVector(Jt.DEFAULT_UP,.02),tf(this.position,this.bounds,this.config.worldEdgeMargin),this.velocity.set(0,0,0),this.lastSafePosition.copy(this.position),this.grounded=!1,this.accumulator=0,this.coyoteTimer=0,this.jumpBufferTimer=0}update(e,t,i){const r=performance.now(),s=NM(t,this.config),o=i.clone();o.y=0,o.lengthSq()<1e-8?o.set(0,0,-1):o.normalize();const a=new z(-o.z,0,o.x),l=o.multiplyScalar(s.direction.y).addScaledVector(a,s.direction.x).multiplyScalar(s.speed);this.accumulator+=Math.min(Math.max(e,0),.1);let c=0;for(;this.accumulator>=this.config.fixedStep&&c<12;)this.fixedUpdate(this.config.fixedStep,l,s.jump),this.accumulator-=this.config.fixedStep,c++;this.lastPhysicsMs=performance.now()-r,this.physicsSamples.push(this.lastPhysicsMs),this.physicsSamples.length>240&&this.physicsSamples.shift()}physicsP95Ms(){if(this.physicsSamples.length===0)return 0;const e=[...this.physicsSamples].sort((t,i)=>t-i);return e[Math.floor((e.length-1)*.95)]}fixedUpdate(e,t,i){const r=(this.grounded?this.config.groundAcceleration:this.config.airAcceleration)*e;this.velocity.x+=Nt.clamp(t.x-this.velocity.x,-r,r),this.velocity.z+=Nt.clamp(t.z-this.velocity.z,-r,r),this.coyoteTimer=this.grounded?this.config.coyoteTime:Math.max(0,this.coyoteTimer-e),this.jumpBufferTimer=i?this.config.jumpBufferTime:Math.max(0,this.jumpBufferTimer-e),this.jumpBufferTimer>0&&(this.grounded||this.coyoteTimer>0)?(this.velocity.y=UM(this.config.jumpHeight,this.config.gravity),this.grounded=!1,this.coyoteTimer=0,this.jumpBufferTimer=0,tt("player.jump")):this.velocity.y-=this.config.gravity*e;const s=this.position.x,o=this.position.z;this.position.addScaledVector(this.velocity,e),tf(this.position,this.bounds,this.config.worldEdgeMargin),this.position.x!==s+this.velocity.x*e&&(this.velocity.x=0),this.position.z!==o+this.velocity.z*e&&(this.velocity.z=0);const a=this.colliders.resolveCapsule(this.position,this.velocity,this.config);this.position.copy(a.position),this.velocity.copy(a.velocity),this.grounded=a.grounded,this.lastPagesTested=a.pagesTested,this.grounded&&this.lastSafePosition.copy(this.position),this.position.y<this.lastSafePosition.y-this.config.recoveryDepth&&(this.position.copy(this.lastSafePosition),this.velocity.set(0,0,0),this.grounded=!1)}}function OM(n,e){const t=n.bounds.center,i=Math.hypot(e.camPos[0]-t[0],e.camPos[1]-t[1],e.camPos[2]-t[2]),r=Math.max(.001,i-n.bounds.radius);return n.errorWorld*e.viewportH/(2*r*Math.tan(e.fovY/2))}const Xu=n=>n.children.filter(e=>!!e),nf=new Set;function BM(n,e,t,i,r,s){const o=r<n?n-r:r>t?r-t:0,a=s<e?e-s:s>i?s-i:0;return o*o+a*a}function kM(n,e){const t=e.nearField;if(!t?.enabled)return!1;const i=t.radius+t.boundaryPadding;return BM(n.footprint.minX,n.footprint.minZ,n.footprint.maxX,n.footprint.maxZ,t.centerX,t.centerZ)<=i*i}function zM(n,e,t){const i=new Set,r=[];let s=0;const o=c=>{const u=Xu(c);if(u.length===0){e.forcedMaxLevel!=null&&c.level>e.forcedMaxLevel&&!nf.has(c.id)&&(console.warn(`force max level ${e.forcedMaxLevel} could not split ${c.id}; no children available`),nf.add(c.id),tt("clod.validation.warning")),r.push(c);return}if(e.forcedMaxLevel!=null&&c.level>e.forcedMaxLevel){i.add(c.id);for(const v of u)o(v);return}const d=OM(c,e),h=t.split.has(c.id),f=kM(c,e),_=h?d>e.thresholdPx/e.hysteresisMergeFactor:d>e.thresholdPx;if(f||_){i.add(c.id),f&&!_&&s++;for(const v of u)o(v)}else r.push(c)};for(const c of n)o(c);let a=0;return{rendered:e.enforce21?VM(r,i,()=>a++):r,state:{split:i},forcedSplits:a,nearFieldForcedSplits:s}}function sa(n,e,t){let i=n.get(e);i||(i=[],n.set(e,i)),i.push(t)}function HM(n){const e=new Map,t=new Map;for(const r of n){const s=r.footprint;sa(e,s.minX,{node:r,side:-1,start:s.minZ,end:s.maxZ}),sa(e,s.maxX,{node:r,side:1,start:s.minZ,end:s.maxZ}),sa(t,s.minZ,{node:r,side:-1,start:s.minX,end:s.maxX}),sa(t,s.maxZ,{node:r,side:1,start:s.minX,end:s.maxX})}const i=r=>{r.sort((s,o)=>s.start-o.start||s.end-o.end);for(let s=0;s<r.length;s++){const o=r[s];for(let a=s+1;a<r.length&&r[a].start<o.end;a++){const l=r[a];if(o.side===l.side||l.end<=o.start||Math.abs(o.node.level-l.node.level)<=1)continue;const c=o.node.level>l.node.level?o.node:l.node;if(Xu(c).length>0)return c}}return null};for(const r of e.values()){const s=i(r);if(s)return s}for(const r of t.values()){const s=i(r);if(s)return s}return null}function VM(n,e,t){let i=[...n];for(let r=0;r<64;r++){const s=HM(i);if(!s)break;const o=Xu(s);e.add(s.id),t(),i=i.filter(a=>a!==s).concat(o)}return i}const Zp=0,GM=1,WM=2,rf=2,Jl=1.25,sf=1,ln=6*4+4+4,Ht=ln/4,Kp=65535,La=Math.pow(2,-24),ju=Symbol("SKIP_GENERATION"),Jp={strategy:Zp,maxDepth:40,maxLeafSize:10,useSharedArrayBuffer:!1,setBoundingBox:!0,onProgress:null,indirect:!1,verbose:!0,range:null,[ju]:!1};function At(n,e,t){return t.min.x=e[n],t.min.y=e[n+1],t.min.z=e[n+2],t.max.x=e[n+3],t.max.y=e[n+4],t.max.z=e[n+5],t}function of(n){let e=-1,t=-1/0;for(let i=0;i<3;i++){const r=n[i+3]-n[i];r>t&&(t=r,e=i)}return e}function af(n,e){e.set(n)}function lf(n,e,t){let i,r;for(let s=0;s<3;s++){const o=s+3;i=n[s],r=e[s],t[s]=i<r?i:r,i=n[o],r=e[o],t[o]=i>r?i:r}}function oa(n,e,t){for(let i=0;i<3;i++){const r=e[n+2*i],s=e[n+2*i+1],o=r-s,a=r+s;o<t[i]&&(t[i]=o),a>t[i+3]&&(t[i+3]=a)}}function Xs(n){const e=n[3]-n[0],t=n[4]-n[1],i=n[5]-n[2];return 2*(e*t+t*i+i*e)}function Vt(n,e){return e[n+15]===Kp}function cn(n,e){return e[n+6]}function _n(n,e){return e[n+14]}function Zt(n){return n+Ht}function Kt(n,e){const t=e[n+6];return n+t*Ht}function qu(n,e){return e[n+7]}function Ql(n,e,t,i,r){let s=1/0,o=1/0,a=1/0,l=-1/0,c=-1/0,u=-1/0,d=1/0,h=1/0,f=1/0,_=-1/0,v=-1/0,g=-1/0;const m=n.offset||0;for(let y=(e-m)*6,S=(e+t-m)*6;y<S;y+=6){const M=n[y+0],R=n[y+1],A=M-R,C=M+R;A<s&&(s=A),C>l&&(l=C),M<d&&(d=M),M>_&&(_=M);const D=n[y+2],$=n[y+3],b=D-$,E=D+$;b<o&&(o=b),E>c&&(c=E),D<h&&(h=D),D>v&&(v=D);const F=n[y+4],O=n[y+5],X=F-O,re=F+O;X<a&&(a=X),re>u&&(u=re),F<f&&(f=F),F>g&&(g=F)}i[0]=s,i[1]=o,i[2]=a,i[3]=l,i[4]=c,i[5]=u,r[0]=d,r[1]=h,r[2]=f,r[3]=_,r[4]=v,r[5]=g}const Si=32,$M=(n,e)=>n.candidate-e.candidate,$i=new Array(Si).fill().map(()=>({count:0,bounds:new Float32Array(6),rightCacheBounds:new Float32Array(6),leftCacheBounds:new Float32Array(6),candidate:0})),aa=new Float32Array(6);function XM(n,e,t,i,r,s){let o=-1,a=0;if(s===Zp)o=of(e),o!==-1&&(a=(e[o]+e[o+3])/2);else if(s===GM)o=of(n),o!==-1&&(a=jM(t,i,r,o));else if(s===WM){const l=Xs(n);let c=Jl*r;const u=t.offset||0,d=(i-u)*6,h=(i+r-u)*6;for(let f=0;f<3;f++){const _=e[f],m=(e[f+3]-_)/Si;if(r<Si/4){const y=[...$i];y.length=r;let S=0;for(let R=d;R<h;R+=6,S++){const A=y[S];A.candidate=t[R+2*f],A.count=0;const{bounds:C,leftCacheBounds:D,rightCacheBounds:$}=A;for(let b=0;b<3;b++)$[b]=1/0,$[b+3]=-1/0,D[b]=1/0,D[b+3]=-1/0,C[b]=1/0,C[b+3]=-1/0;oa(R,t,C)}y.sort($M);let M=r;for(let R=0;R<M;R++){const A=y[R];for(;R+1<M&&y[R+1].candidate===A.candidate;)y.splice(R+1,1),M--}for(let R=d;R<h;R+=6){const A=t[R+2*f];for(let C=0;C<M;C++){const D=y[C];A>=D.candidate?oa(R,t,D.rightCacheBounds):(oa(R,t,D.leftCacheBounds),D.count++)}}for(let R=0;R<M;R++){const A=y[R],C=A.count,D=r-A.count,$=A.leftCacheBounds,b=A.rightCacheBounds;let E=0;C!==0&&(E=Xs($)/l);let F=0;D!==0&&(F=Xs(b)/l);const O=sf+Jl*(E*C+F*D);O<c&&(o=f,c=O,a=A.candidate)}}else{for(let M=0;M<Si;M++){const R=$i[M];R.count=0,R.candidate=_+m+M*m;const A=R.bounds;for(let C=0;C<3;C++)A[C]=1/0,A[C+3]=-1/0}for(let M=d;M<h;M+=6){let C=~~((t[M+2*f]-_)/m);C>=Si&&(C=Si-1);const D=$i[C];D.count++,oa(M,t,D.bounds)}const y=$i[Si-1];af(y.bounds,y.rightCacheBounds);for(let M=Si-2;M>=0;M--){const R=$i[M],A=$i[M+1];lf(R.bounds,A.rightCacheBounds,R.rightCacheBounds)}let S=0;for(let M=0;M<Si-1;M++){const R=$i[M],A=R.count,C=R.bounds,$=$i[M+1].rightCacheBounds;A!==0&&(S===0?af(C,aa):lf(C,aa,aa)),S+=A;let b=0,E=0;S!==0&&(b=Xs(aa)/l);const F=r-S;F!==0&&(E=Xs($)/l);const O=sf+Jl*(b*S+E*F);O<c&&(o=f,c=O,a=R.candidate)}}}}else console.warn(`BVH: Invalid build strategy value ${s} used.`);return{axis:o,pos:a}}function jM(n,e,t,i){let r=0;const s=n.offset;for(let o=e,a=e+t;o<a;o++)r+=n[(o-s)*6+i*2];return r/t}class ec{constructor(){this.boundingData=new Float32Array(6)}}function qM(n,e,t,i,r,s){let o=i,a=i+r-1;const l=s.pos,c=s.axis*2,u=t.offset||0;for(;;){for(;o<=a&&t[(o-u)*6+c]<l;)o++;for(;o<=a&&t[(a-u)*6+c]>=l;)a--;if(o<a){for(let d=0;d<e;d++){let h=n[o*e+d];n[o*e+d]=n[a*e+d],n[a*e+d]=h}for(let d=0;d<6;d++){const h=o-u,f=a-u,_=t[h*6+d];t[h*6+d]=t[f*6+d],t[f*6+d]=_}o++,a--}else return o}}let Qp,Ia,au,em;const YM=Math.pow(2,32);function lu(n){return"count"in n?1:1+lu(n.left)+lu(n.right)}function ZM(n,e,t){return Qp=new Float32Array(t),Ia=new Uint32Array(t),au=new Uint16Array(t),em=new Uint8Array(t),cu(n,e)}function cu(n,e){const t=n/4,i=n/2,r="count"in e,s=e.boundingData;for(let o=0;o<6;o++)Qp[t+o]=s[o];if(r)return e.buffer?(em.set(new Uint8Array(e.buffer),n),n+e.buffer.byteLength):(Ia[t+6]=e.offset,au[i+14]=e.count,au[i+15]=Kp,n+ln);{const{left:o,right:a,splitAxis:l}=e,c=n+ln;let u=cu(c,o);const d=n/ln,f=u/ln-d;if(f>YM)throw new Error("MeshBVH: Cannot store relative child node offset greater than 32 bits.");return Ia[t+6]=f,Ia[t+7]=l,cu(u,a)}}function KM(n,e,t,i,r,s){const{maxDepth:o,verbose:a,maxLeafSize:l,strategy:c,onProgress:u}=r,d=n.primitiveBuffer,h=n.primitiveBufferStride,f=new Float32Array(6);let _=!1;const v=new ec;return Ql(e,t,i,v.boundingData,f),m(v,t,i,f),v;function g(y){u&&u((y-s.offset)/s.count)}function m(y,S,M,R=null,A=0){if(!_&&A>=o&&(_=!0,a&&console.warn(`BVH: Max depth of ${o} reached when generating BVH. Consider increasing maxDepth.`)),M<=l||A>=o)return g(S+M),y.offset=S,y.count=M,y;const C=XM(y.boundingData,R,e,S,M,c);if(C.axis===-1)return g(S+M),y.offset=S,y.count=M,y;const D=qM(d,h,e,S,M,C);if(D===S||D===S+M)g(S+M),y.offset=S,y.count=M;else{y.splitAxis=C.axis;const $=new ec,b=S,E=D-S;y.left=$,Ql(e,b,E,$.boundingData,f),m($,b,E,f,A+1);const F=new ec,O=D,X=M-E;y.right=F,Ql(e,O,X,F.boundingData,f),m(F,O,X,f,A+1)}return y}}function JM(n,e){const t=e.useSharedArrayBuffer?SharedArrayBuffer:ArrayBuffer,i=n.getRootRanges(e.range),r=i[0],s=i[i.length-1],o={offset:r.offset,count:s.offset+s.count-r.offset},a=new Float32Array(6*o.count);a.offset=o.offset,n.computePrimitiveBounds(o.offset,o.count,a),n._roots=i.map(l=>{const c=KM(n,a,l.offset,l.count,e,o),u=lu(c),d=new t(ln*u);return ZM(0,c,d),d})}class Yu{constructor(e){this._getNewPrimitive=e,this._primitives=[]}getPrimitive(){const e=this._primitives;return e.length===0?this._getNewPrimitive():e.pop()}releasePrimitive(e){this._primitives.push(e)}}class QM{constructor(){this.float32Array=null,this.uint16Array=null,this.uint32Array=null;const e=[];let t=null;this.setBuffer=i=>{t&&e.push(t),t=i,this.float32Array=new Float32Array(i),this.uint16Array=new Uint16Array(i),this.uint32Array=new Uint32Array(i)},this.clearBuffer=()=>{t=null,this.float32Array=null,this.uint16Array=null,this.uint32Array=null,e.length!==0&&this.setBuffer(e.pop())}}}const Mt=new QM;let Qi,fs;const Jr=[],la=new Yu(()=>new $t);function ew(n,e,t,i,r,s){Qi=la.getPrimitive(),fs=la.getPrimitive(),Jr.push(Qi,fs),Mt.setBuffer(n._roots[e]);const o=uu(0,n.geometry,t,i,r,s);Mt.clearBuffer(),la.releasePrimitive(Qi),la.releasePrimitive(fs),Jr.pop(),Jr.pop();const a=Jr.length;return a>0&&(fs=Jr[a-1],Qi=Jr[a-2]),o}function uu(n,e,t,i,r=null,s=0,o=0){const{float32Array:a,uint16Array:l,uint32Array:c}=Mt;let u=n*2;if(Vt(u,l)){const h=cn(n,c),f=_n(u,l);return At(n,a,Qi),i(h,f,!1,o,s+n/Ht,Qi)}else{let b=function(F){const{uint16Array:O,uint32Array:X}=Mt;let re=F*2;for(;!Vt(re,O);)F=Zt(F),re=F*2;return cn(F,X)},E=function(F){const{uint16Array:O,uint32Array:X}=Mt;let re=F*2;for(;!Vt(re,O);)F=Kt(F,X),re=F*2;return cn(F,X)+_n(re,O)};const h=Zt(n),f=Kt(n,c);let _=h,v=f,g,m,y,S;if(r&&(y=Qi,S=fs,At(_,a,y),At(v,a,S),g=r(y),m=r(S),m<g)){_=f,v=h;const F=g;g=m,m=F,y=S}y||(y=Qi,At(_,a,y));const M=Vt(_*2,l),R=t(y,M,g,o+1,s+_/Ht);let A;if(R===rf){const F=b(_),X=E(_)-F;A=i(F,X,!0,o+1,s+_/Ht,y)}else A=R&&uu(_,e,t,i,r,s,o+1);if(A)return!0;S=fs,At(v,a,S);const C=Vt(v*2,l),D=t(S,C,m,o+1,s+v/Ht);let $;if(D===rf){const F=b(v),X=E(v)-F;$=i(F,X,!0,o+1,s+v/Ht,S)}else $=D&&uu(v,e,t,i,r,s,o+1);return!!$}}const ao=new Mt.constructor,Ha=new Mt.constructor,Yi=new Yu(()=>new $t),Qr=new $t,es=new $t,tc=new $t,nc=new $t;let ic=!1;function tw(n,e,t,i){if(ic)throw new Error("MeshBVH: Recursive calls to bvhcast not supported.");ic=!0;const r=n._roots,s=e._roots;let o,a=0,l=0;const c=new ht().copy(t).invert();for(let u=0,d=r.length;u<d;u++){ao.setBuffer(r[u]),l=0;const h=Yi.getPrimitive();At(0,ao.float32Array,h),h.applyMatrix4(c);for(let f=0,_=s.length;f<_&&(Ha.setBuffer(s[f]),o=Jn(0,0,t,c,i,a,l,0,0,h),Ha.clearBuffer(),l+=s[f].byteLength/ln,!o);f++);if(Yi.releasePrimitive(h),ao.clearBuffer(),a+=r[u].byteLength/ln,o)break}return ic=!1,o}function Jn(n,e,t,i,r,s=0,o=0,a=0,l=0,c=null,u=!1){let d,h;u?(d=Ha,h=ao):(d=ao,h=Ha);const f=d.float32Array,_=d.uint32Array,v=d.uint16Array,g=h.float32Array,m=h.uint32Array,y=h.uint16Array,S=n*2,M=e*2,R=Vt(S,v),A=Vt(M,y);let C=!1;if(A&&R)u?C=r(cn(e,m),_n(e*2,y),cn(n,_),_n(n*2,v),l,o+e/Ht,a,s+n/Ht):C=r(cn(n,_),_n(n*2,v),cn(e,m),_n(e*2,y),a,s+n/Ht,l,o+e/Ht);else if(A){const D=Yi.getPrimitive();At(e,g,D),D.applyMatrix4(t);const $=Zt(n),b=Kt(n,_);At($,f,Qr),At(b,f,es);const E=D.intersectsBox(Qr),F=D.intersectsBox(es);C=E&&Jn(e,$,i,t,r,o,s,l,a+1,D,!u)||F&&Jn(e,b,i,t,r,o,s,l,a+1,D,!u),Yi.releasePrimitive(D)}else{const D=Zt(e),$=Kt(e,m);At(D,g,tc),At($,g,nc);const b=c.intersectsBox(tc),E=c.intersectsBox(nc);if(b&&E)C=Jn(n,D,t,i,r,s,o,a,l+1,c,u)||Jn(n,$,t,i,r,s,o,a,l+1,c,u);else if(b)if(R)C=Jn(n,D,t,i,r,s,o,a,l+1,c,u);else{const F=Yi.getPrimitive();F.copy(tc).applyMatrix4(t);const O=Zt(n),X=Kt(n,_);At(O,f,Qr),At(X,f,es);const re=F.intersectsBox(Qr),K=F.intersectsBox(es);C=re&&Jn(D,O,i,t,r,o,s,l,a+1,F,!u)||K&&Jn(D,X,i,t,r,o,s,l,a+1,F,!u),Yi.releasePrimitive(F)}else if(E)if(R)C=Jn(n,$,t,i,r,s,o,a,l+1,c,u);else{const F=Yi.getPrimitive();F.copy(nc).applyMatrix4(t);const O=Zt(n),X=Kt(n,_);At(O,f,Qr),At(X,f,es);const re=F.intersectsBox(Qr),K=F.intersectsBox(es);C=re&&Jn($,O,i,t,r,o,s,l,a+1,F,!u)||K&&Jn($,X,i,t,r,o,s,l,a+1,F,!u),Yi.releasePrimitive(F)}}return C}const cf=new $t,ts=new Float32Array(6);class nw{constructor(){this._roots=null,this.primitiveBuffer=null,this.primitiveBufferStride=null}init(e){e={...Jp,...e},JM(this,e)}getRootRanges(){throw new Error("BVH: getRootRanges() not implemented")}writePrimitiveBounds(){throw new Error("BVH: writePrimitiveBounds() not implemented")}writePrimitiveRangeBounds(e,t,i,r){let s=1/0,o=1/0,a=1/0,l=-1/0,c=-1/0,u=-1/0;for(let d=e,h=e+t;d<h;d++){this.writePrimitiveBounds(d,ts,0);const[f,_,v,g,m,y]=ts;f<s&&(s=f),g>l&&(l=g),_<o&&(o=_),m>c&&(c=m),v<a&&(a=v),y>u&&(u=y)}return i[r+0]=s,i[r+1]=o,i[r+2]=a,i[r+3]=l,i[r+4]=c,i[r+5]=u,i}computePrimitiveBounds(e,t,i){const r=i.offset||0;for(let s=e,o=e+t;s<o;s++){this.writePrimitiveBounds(s,ts,0);const[a,l,c,u,d,h]=ts,f=(a+u)/2,_=(l+d)/2,v=(c+h)/2,g=(u-a)/2,m=(d-l)/2,y=(h-c)/2,S=(s-r)*6;i[S+0]=f,i[S+1]=g+(Math.abs(f)+g)*La,i[S+2]=_,i[S+3]=m+(Math.abs(_)+m)*La,i[S+4]=v,i[S+5]=y+(Math.abs(v)+y)*La}return i}shiftPrimitiveOffsets(e){const t=this._indirectBuffer;if(t)for(let i=0,r=t.length;i<r;i++)t[i]+=e;else{const i=this._roots;for(let r=0;r<i.length;r++){const s=i[r],o=new Uint32Array(s),a=new Uint16Array(s),l=s.byteLength/ln;for(let c=0;c<l;c++){const u=Ht*c,d=2*u;Vt(d,a)&&(o[u+6]+=e)}}}}traverse(e,t=0){const i=this._roots[t],r=new Uint32Array(i),s=new Uint16Array(i);o(0);function o(a,l=0){const c=a*2,u=Vt(c,s);if(u){const d=r[a+6],h=s[c+14];e(l,u,new Float32Array(i,a*4,6),d,h)}else{const d=Zt(a),h=Kt(a,r),f=qu(a,r);e(l,u,new Float32Array(i,a*4,6),f)||(o(d,l+1),o(h,l+1))}}}refit(){const e=this._roots;for(let t=0,i=e.length;t<i;t++){const r=e[t],s=new Uint32Array(r),o=new Uint16Array(r),a=new Float32Array(r),l=r.byteLength/ln;for(let c=l-1;c>=0;c--){const u=c*Ht,d=u*2;if(Vt(d,o)){const f=cn(u,s),_=_n(d,o);this.writePrimitiveRangeBounds(f,_,ts,0),a.set(ts,u)}else{const f=Zt(u),_=Kt(u,s);for(let v=0;v<3;v++){const g=a[f+v],m=a[f+v+3],y=a[_+v],S=a[_+v+3];a[u+v]=g<y?g:y,a[u+v+3]=m>S?m:S}}}}}getBoundingBox(e){return e.makeEmpty(),this._roots.forEach(i=>{At(0,new Float32Array(i),cf),e.union(cf)}),e}shapecast(e){let{boundsTraverseOrder:t,intersectsBounds:i,intersectsRange:r,intersectsPrimitive:s,scratchPrimitive:o,iterate:a}=e;if(r&&s){const d=r;r=(h,f,_,v,g)=>d(h,f,_,v,g)?!0:a(h,f,this,s,_,v,o)}else r||(s?r=(d,h,f,_)=>a(d,h,this,s,f,_,o):r=(d,h,f)=>f);let l=!1,c=0;const u=this._roots;for(let d=0,h=u.length;d<h;d++){const f=u[d];if(l=ew(this,d,i,r,t,c),l)break;c+=f.byteLength/ln}return l}bvhcast(e,t,i){let{intersectsRanges:r}=i;return tw(this,e,t,r)}}function iw(){return typeof SharedArrayBuffer<"u"}function Zu(n){return n.index?n.index.count:n.attributes.position.count}function Za(n){return Zu(n)/3}function rw(n,e=ArrayBuffer){return n>65535?new Uint32Array(new e(4*n)):new Uint16Array(new e(2*n))}function sw(n,e){if(!n.index){const t=n.attributes.position.count,i=e.useSharedArrayBuffer?SharedArrayBuffer:ArrayBuffer,r=rw(t,i);n.setIndex(new pt(r,1));for(let s=0;s<t;s++)r[s]=s}}function ow(n,e,t){const i=Zu(n)/t,r=e||n.drawRange,s=r.start/t,o=(r.start+r.count)/t,a=Math.max(0,s),l=Math.min(i,o)-a;return{offset:Math.floor(a),count:Math.floor(l)}}function aw(n,e){return n.groups.map(t=>({offset:t.start/e,count:t.count/e}))}function uf(n,e,t){const i=ow(n,e,t),r=aw(n,t);if(!r.length)return[i];const s=[],o=i.offset,a=i.offset+i.count,l=Zu(n)/t,c=[];for(const h of r){const{offset:f,count:_}=h,v=f,g=isFinite(_)?_:l-f,m=f+g;v<a&&m>o&&(c.push({pos:Math.max(o,v),isStart:!0}),c.push({pos:Math.min(a,m),isStart:!1}))}c.sort((h,f)=>h.pos!==f.pos?h.pos-f.pos:h.type==="end"?-1:1);let u=0,d=null;for(const h of c){const f=h.pos;u!==0&&f!==d&&s.push({offset:d,count:f-d}),u+=h.isStart?1:-1,d=f}return s}function lw(n,e){const t=n[n.length-1],i=t.offset+t.count>2**16,r=n.reduce((c,u)=>c+u.count,0),s=i?4:2,o=e?new SharedArrayBuffer(r*s):new ArrayBuffer(r*s),a=i?new Uint32Array(o):new Uint16Array(o);let l=0;for(let c=0;c<n.length;c++){const{offset:u,count:d}=n[c];for(let h=0;h<d;h++)a[l+h]=u+h;l+=d}return a}class cw extends nw{get indirect(){return!!this._indirectBuffer}get primitiveStride(){return null}get primitiveBufferStride(){return this.indirect?1:this.primitiveStride}set primitiveBufferStride(e){}get primitiveBuffer(){return this.indirect?this._indirectBuffer:this.geometry.index.array}set primitiveBuffer(e){}constructor(e,t={}){if(e.isBufferGeometry){if(e.index&&e.index.isInterleavedBufferAttribute)throw new Error("BVH: InterleavedBufferAttribute is not supported for the index attribute.")}else throw new Error("BVH: Only BufferGeometries are supported.");if(t.useSharedArrayBuffer&&!iw())throw new Error("BVH: SharedArrayBuffer is not available.");super(),this.geometry=e,this.resolvePrimitiveIndex=t.indirect?i=>this._indirectBuffer[i]:i=>i,this.primitiveBuffer=null,this.primitiveBufferStride=null,this._indirectBuffer=null,t={...Jp,...t},t[ju]||this.init(t)}init(e){const{geometry:t,primitiveStride:i}=this;if(e.indirect){const r=uf(t,e.range,i),s=lw(r,e.useSharedArrayBuffer);this._indirectBuffer=s}else sw(t,e);super.init(e),!t.boundingBox&&e.setBoundingBox&&(t.boundingBox=this.getBoundingBox(new $t))}getRootRanges(e){return this.indirect?[{offset:0,count:this._indirectBuffer.length}]:uf(this.geometry,e,this.primitiveStride)}raycastObject3D(){throw new Error("BVH: raycastObject3D() not implemented")}}class Li{constructor(){this.min=1/0,this.max=-1/0}setFromPointsField(e,t){let i=1/0,r=-1/0;for(let s=0,o=e.length;s<o;s++){const l=e[s][t];i=l<i?l:i,r=l>r?l:r}this.min=i,this.max=r}setFromPoints(e,t){let i=1/0,r=-1/0;for(let s=0,o=t.length;s<o;s++){const a=t[s],l=e.dot(a);i=l<i?l:i,r=l>r?l:r}this.min=i,this.max=r}isSeparated(e){return this.min>e.max||e.min>this.max}}Li.prototype.setFromBox=function(){const n=new z;return function(t,i){const r=i.min,s=i.max;let o=1/0,a=-1/0;for(let l=0;l<=1;l++)for(let c=0;c<=1;c++)for(let u=0;u<=1;u++){n.x=r.x*l+s.x*(1-l),n.y=r.y*c+s.y*(1-c),n.z=r.z*u+s.z*(1-u);const d=t.dot(n);o=Math.min(d,o),a=Math.max(d,a)}this.min=o,this.max=a}}();const uw=function(){const n=new z,e=new z,t=new z;return function(r,s,o){const a=r.start,l=n,c=s.start,u=e;t.subVectors(a,c),n.subVectors(r.end,r.start),e.subVectors(s.end,s.start);const d=t.dot(u),h=u.dot(l),f=u.dot(u),_=t.dot(l),g=l.dot(l)*f-h*h;let m,y;g!==0?m=(d*h-_*f)/g:m=0,y=(d+m*h)/f,o.x=m,o.y=y}}(),Ku=function(){const n=new Xe,e=new z,t=new z;return function(r,s,o,a){uw(r,s,n);let l=n.x,c=n.y;if(l>=0&&l<=1&&c>=0&&c<=1){r.at(l,o),s.at(c,a);return}else if(l>=0&&l<=1){c<0?s.at(0,a):s.at(1,a),r.closestPointToPoint(a,!0,o);return}else if(c>=0&&c<=1){l<0?r.at(0,o):r.at(1,o),s.closestPointToPoint(o,!0,a);return}else{let u;l<0?u=r.start:u=r.end;let d;c<0?d=s.start:d=s.end;const h=e,f=t;if(r.closestPointToPoint(d,!0,e),s.closestPointToPoint(u,!0,t),h.distanceToSquared(d)<=f.distanceToSquared(u)){o.copy(h),a.copy(d);return}else{o.copy(u),a.copy(f);return}}}}(),dw=function(){const n=new z,e=new z,t=new ri,i=new di;return function(s,o){const{radius:a,center:l}=s,{a:c,b:u,c:d}=o;if(i.start=c,i.end=u,i.closestPointToPoint(l,!0,n).distanceTo(l)<=a||(i.start=c,i.end=d,i.closestPointToPoint(l,!0,n).distanceTo(l)<=a)||(i.start=u,i.end=d,i.closestPointToPoint(l,!0,n).distanceTo(l)<=a))return!0;const v=o.getPlane(t);if(Math.abs(v.distanceToPoint(l))<=a){const m=v.projectPoint(l,e);if(o.containsPoint(m))return!0}return!1}}(),hw=["x","y","z"],Ti=1e-15,df=Ti*Ti;function On(n){return Math.abs(n)<Ti}class ei extends tn{constructor(...e){super(...e),this.isExtendedTriangle=!0,this.satAxes=new Array(4).fill().map(()=>new z),this.satBounds=new Array(4).fill().map(()=>new Li),this.points=[this.a,this.b,this.c],this.plane=new ri,this.isDegenerateIntoSegment=!1,this.isDegenerateIntoPoint=!1,this.degenerateSegment=new di,this.needsUpdate=!0}intersectsSphere(e){return dw(e,this)}update(){const e=this.a,t=this.b,i=this.c,r=this.points,s=this.satAxes,o=this.satBounds,a=s[0],l=o[0];this.getNormal(a),l.setFromPoints(a,r);const c=s[1],u=o[1];c.subVectors(e,t),u.setFromPoints(c,r);const d=s[2],h=o[2];d.subVectors(t,i),h.setFromPoints(d,r);const f=s[3],_=o[3];f.subVectors(i,e),_.setFromPoints(f,r);const v=c.length(),g=d.length(),m=f.length();this.isDegenerateIntoPoint=!1,this.isDegenerateIntoSegment=!1,v<Ti?g<Ti||m<Ti?this.isDegenerateIntoPoint=!0:(this.isDegenerateIntoSegment=!0,this.degenerateSegment.start.copy(e),this.degenerateSegment.end.copy(i)):g<Ti?m<Ti?this.isDegenerateIntoPoint=!0:(this.isDegenerateIntoSegment=!0,this.degenerateSegment.start.copy(t),this.degenerateSegment.end.copy(e)):m<Ti&&(this.isDegenerateIntoSegment=!0,this.degenerateSegment.start.copy(i),this.degenerateSegment.end.copy(t)),this.plane.setFromNormalAndCoplanarPoint(a,e),this.needsUpdate=!1}}ei.prototype.closestPointToSegment=function(){const n=new z,e=new z,t=new di;return function(r,s=null,o=null){const{start:a,end:l}=r,c=this.points;let u,d=1/0;for(let h=0;h<3;h++){const f=(h+1)%3;t.start.copy(c[h]),t.end.copy(c[f]),Ku(t,r,n,e),u=n.distanceToSquared(e),u<d&&(d=u,s&&s.copy(n),o&&o.copy(e))}return this.closestPointToPoint(a,n),u=a.distanceToSquared(n),u<d&&(d=u,s&&s.copy(n),o&&o.copy(a)),this.closestPointToPoint(l,n),u=l.distanceToSquared(n),u<d&&(d=u,s&&s.copy(n),o&&o.copy(l)),Math.sqrt(d)}}();ei.prototype.intersectsTriangle=function(){const n=new ei,e=new Li,t=new Li,i=new z,r=new z,s=new z,o=new z,a=new di,l=new di,c=new z,u=new Xe,d=new Xe;function h(S,M,R,A){const C=i;!S.isDegenerateIntoPoint&&!S.isDegenerateIntoSegment?C.copy(S.plane.normal):C.copy(M.plane.normal);const D=S.satBounds,$=S.satAxes;for(let F=1;F<4;F++){const O=D[F],X=$[F];if(e.setFromPoints(X,M.points),O.isSeparated(e)||(o.copy(C).cross(X),e.setFromPoints(o,S.points),t.setFromPoints(o,M.points),e.isSeparated(t)))return!1}const b=M.satBounds,E=M.satAxes;for(let F=1;F<4;F++){const O=b[F],X=E[F];if(e.setFromPoints(X,S.points),O.isSeparated(e)||(o.crossVectors(C,X),e.setFromPoints(o,S.points),t.setFromPoints(o,M.points),e.isSeparated(t)))return!1}return R&&(A||console.warn("ExtendedTriangle.intersectsTriangle: Triangles are coplanar which does not support an output edge. Setting edge to 0, 0, 0."),R.start.set(0,0,0),R.end.set(0,0,0)),!0}function f(S,M,R,A,C,D,$,b,E,F,O){let X=$/($-b);F.x=A+(C-A)*X,O.start.subVectors(M,S).multiplyScalar(X).add(S),X=$/($-E),F.y=A+(D-A)*X,O.end.subVectors(R,S).multiplyScalar(X).add(S)}function _(S,M,R,A,C,D,$,b,E,F,O){if(C>0)f(S.c,S.a,S.b,A,M,R,E,$,b,F,O);else if(D>0)f(S.b,S.a,S.c,R,M,A,b,$,E,F,O);else if(b*E>0||$!=0)f(S.a,S.b,S.c,M,R,A,$,b,E,F,O);else if(b!=0)f(S.b,S.a,S.c,R,M,A,b,$,E,F,O);else if(E!=0)f(S.c,S.a,S.b,A,M,R,E,$,b,F,O);else return!0;return!1}function v(S,M,R,A){const C=M.degenerateSegment,D=S.plane.distanceToPoint(C.start),$=S.plane.distanceToPoint(C.end);return On(D)?On($)?h(S,M,R,A):(R&&(R.start.copy(C.start),R.end.copy(C.start)),S.containsPoint(C.start)):On($)?(R&&(R.start.copy(C.end),R.end.copy(C.end)),S.containsPoint(C.end)):S.plane.intersectLine(C,i)!=null?(R&&(R.start.copy(i),R.end.copy(i)),S.containsPoint(i)):!1}function g(S,M,R){const A=M.a;return On(S.plane.distanceToPoint(A))&&S.containsPoint(A)?(R&&(R.start.copy(A),R.end.copy(A)),!0):!1}function m(S,M,R){const A=S.degenerateSegment,C=M.a;return A.closestPointToPoint(C,!0,i),C.distanceToSquared(i)<df?(R&&(R.start.copy(C),R.end.copy(C)),!0):!1}function y(S,M,R,A){if(S.isDegenerateIntoSegment)if(M.isDegenerateIntoSegment){const C=S.degenerateSegment,D=M.degenerateSegment,$=r,b=s;C.delta($),D.delta(b);const E=i.subVectors(D.start,C.start),F=$.x*b.y-$.y*b.x;if(On(F))return!1;const O=(E.x*b.y-E.y*b.x)/F,X=-($.x*E.y-$.y*E.x)/F;if(O<0||O>1||X<0||X>1)return!1;const re=C.start.z+$.z*O,K=D.start.z+b.z*X;return On(re-K)?(R&&(R.start.copy(C.start).addScaledVector($,O),R.end.copy(C.start).addScaledVector($,O)),!0):!1}else return M.isDegenerateIntoPoint?m(S,M,R):v(M,S,R,A);else{if(S.isDegenerateIntoPoint)return M.isDegenerateIntoPoint?M.a.distanceToSquared(S.a)<df?(R&&(R.start.copy(S.a),R.end.copy(S.a)),!0):!1:M.isDegenerateIntoSegment?m(M,S,R):g(M,S,R);if(M.isDegenerateIntoPoint)return g(S,M,R);if(M.isDegenerateIntoSegment)return v(S,M,R,A)}}return function(M,R=null,A=!1){this.needsUpdate&&this.update(),M.isExtendedTriangle?M.needsUpdate&&M.update():(n.copy(M),n.update(),M=n);const C=y(this,M,R,A);if(C!==void 0)return C;const D=this.plane,$=M.plane;let b=$.distanceToPoint(this.a),E=$.distanceToPoint(this.b),F=$.distanceToPoint(this.c);On(b)&&(b=0),On(E)&&(E=0),On(F)&&(F=0);const O=b*E,X=b*F;if(O>0&&X>0)return!1;let re=D.distanceToPoint(M.a),K=D.distanceToPoint(M.b),he=D.distanceToPoint(M.c);On(re)&&(re=0),On(K)&&(K=0),On(he)&&(he=0);const j=re*K,Ee=re*he;if(j>0&&Ee>0)return!1;r.copy(D.normal),s.copy($.normal);const _e=r.cross(s);let Se=0,Me=Math.abs(_e.x);const ze=Math.abs(_e.y);ze>Me&&(Me=ze,Se=1),Math.abs(_e.z)>Me&&(Se=2);const me=hw[Se],we=this.a[me],ye=this.b[me],Ve=this.c[me],Ne=M.a[me],qe=M.b[me],Be=M.c[me];if(_(this,we,ye,Ve,O,X,b,E,F,u,a))return h(this,M,R,A);if(_(M,Ne,qe,Be,j,Ee,re,K,he,d,l))return h(this,M,R,A);if(u.y<u.x){const Ge=u.y;u.y=u.x,u.x=Ge,c.copy(a.start),a.start.copy(a.end),a.end.copy(c)}if(d.y<d.x){const Ge=d.y;d.y=d.x,d.x=Ge,c.copy(l.start),l.start.copy(l.end),l.end.copy(c)}return u.y<d.x||d.y<u.x?!1:(R&&(d.x>u.x?R.start.copy(l.start):R.start.copy(a.start),d.y<u.y?R.end.copy(l.end):R.end.copy(a.end)),!0)}}();ei.prototype.distanceToPoint=function(){const n=new z;return function(t){return this.closestPointToPoint(t,n),t.distanceTo(n)}}();ei.prototype.distanceToTriangle=function(){const n=new z,e=new z,t=["a","b","c"],i=new di,r=new di;return function(o,a=null,l=null){const c=a||l?i:null;if(this.intersectsTriangle(o,c,!0))return(a||l)&&(a&&c.getCenter(a),l&&c.getCenter(l)),0;let u=1/0;for(let d=0;d<3;d++){let h;const f=t[d],_=o[f];this.closestPointToPoint(_,n),h=_.distanceToSquared(n),h<u&&(u=h,a&&a.copy(n),l&&l.copy(_));const v=this[f];o.closestPointToPoint(v,n),h=v.distanceToSquared(n),h<u&&(u=h,a&&a.copy(v),l&&l.copy(n))}for(let d=0;d<3;d++){const h=t[d],f=t[(d+1)%3];i.set(this[h],this[f]);for(let _=0;_<3;_++){const v=t[_],g=t[(_+1)%3];r.set(o[v],o[g]),Ku(i,r,n,e);const m=n.distanceToSquared(e);m<u&&(u=m,a&&a.copy(n),l&&l.copy(e))}}return Math.sqrt(u)}}();class yn{constructor(e,t,i){this.isOrientedBox=!0,this.min=new z,this.max=new z,this.matrix=new ht,this.invMatrix=new ht,this.points=new Array(8).fill().map(()=>new z),this.satAxes=new Array(3).fill().map(()=>new z),this.satBounds=new Array(3).fill().map(()=>new Li),this.alignedSatBounds=new Array(3).fill().map(()=>new Li),this.needsUpdate=!1,e&&this.min.copy(e),t&&this.max.copy(t),i&&this.matrix.copy(i)}set(e,t,i){this.min.copy(e),this.max.copy(t),this.matrix.copy(i),this.needsUpdate=!0}copy(e){this.min.copy(e.min),this.max.copy(e.max),this.matrix.copy(e.matrix),this.needsUpdate=!0}}yn.prototype.update=function(){return function(){const e=this.matrix,t=this.min,i=this.max,r=this.points;for(let c=0;c<=1;c++)for(let u=0;u<=1;u++)for(let d=0;d<=1;d++){const h=1*c|2*u|4*d,f=r[h];f.x=c?i.x:t.x,f.y=u?i.y:t.y,f.z=d?i.z:t.z,f.applyMatrix4(e)}const s=this.satBounds,o=this.satAxes,a=r[0];for(let c=0;c<3;c++){const u=o[c],d=s[c],h=1<<c,f=r[h];u.subVectors(a,f),d.setFromPoints(u,r)}const l=this.alignedSatBounds;l[0].setFromPointsField(r,"x"),l[1].setFromPointsField(r,"y"),l[2].setFromPointsField(r,"z"),this.invMatrix.copy(this.matrix).invert(),this.needsUpdate=!1}}();yn.prototype.intersectsBox=function(){const n=new Li;return function(t){this.needsUpdate&&this.update();const i=t.min,r=t.max,s=this.satBounds,o=this.satAxes,a=this.alignedSatBounds;if(n.min=i.x,n.max=r.x,a[0].isSeparated(n)||(n.min=i.y,n.max=r.y,a[1].isSeparated(n))||(n.min=i.z,n.max=r.z,a[2].isSeparated(n)))return!1;for(let l=0;l<3;l++){const c=o[l],u=s[l];if(n.setFromBox(c,t),u.isSeparated(n))return!1}return!0}}();yn.prototype.intersectsTriangle=function(){const n=new ei,e=new Array(3),t=new Li,i=new Li,r=new z;return function(o){this.needsUpdate&&this.update(),o.isExtendedTriangle?o.needsUpdate&&o.update():(n.copy(o),n.update(),o=n);const a=this.satBounds,l=this.satAxes;e[0]=o.a,e[1]=o.b,e[2]=o.c;for(let h=0;h<3;h++){const f=a[h],_=l[h];if(t.setFromPoints(_,e),f.isSeparated(t))return!1}const c=o.satBounds,u=o.satAxes,d=this.points;for(let h=0;h<3;h++){const f=c[h],_=u[h];if(t.setFromPoints(_,d),f.isSeparated(t))return!1}for(let h=0;h<3;h++){const f=l[h];for(let _=0;_<4;_++){const v=u[_];if(r.crossVectors(f,v),t.setFromPoints(r,e),i.setFromPoints(r,d),t.isSeparated(i))return!1}}return!0}}();yn.prototype.closestPointToPoint=function(){return function(e,t){return this.needsUpdate&&this.update(),t.copy(e).applyMatrix4(this.invMatrix).clamp(this.min,this.max).applyMatrix4(this.matrix),t}}();yn.prototype.distanceToPoint=function(){const n=new z;return function(t){return this.closestPointToPoint(t,n),t.distanceTo(n)}}();yn.prototype.distanceToBox=function(){const n=["x","y","z"],e=new Array(12).fill().map(()=>new di),t=new Array(12).fill().map(()=>new di),i=new z,r=new z;return function(o,a=0,l=null,c=null){if(this.needsUpdate&&this.update(),this.intersectsBox(o))return(l||c)&&(o.getCenter(r),this.closestPointToPoint(r,i),o.closestPointToPoint(i,r),l&&l.copy(i),c&&c.copy(r)),0;const u=a*a,d=o.min,h=o.max,f=this.points;let _=1/0;for(let g=0;g<8;g++){const m=f[g];r.copy(m).clamp(d,h);const y=m.distanceToSquared(r);if(y<_&&(_=y,l&&l.copy(m),c&&c.copy(r),y<u))return Math.sqrt(y)}let v=0;for(let g=0;g<3;g++)for(let m=0;m<=1;m++)for(let y=0;y<=1;y++){const S=(g+1)%3,M=(g+2)%3,R=m<<S|y<<M,A=1<<g|m<<S|y<<M,C=f[R],D=f[A];e[v].set(C,D);const b=n[g],E=n[S],F=n[M],O=t[v],X=O.start,re=O.end;X[b]=d[b],X[E]=m?d[E]:h[E],X[F]=y?d[F]:h[E],re[b]=h[b],re[E]=m?d[E]:h[E],re[F]=y?d[F]:h[E],v++}for(let g=0;g<=1;g++)for(let m=0;m<=1;m++)for(let y=0;y<=1;y++){r.x=g?h.x:d.x,r.y=m?h.y:d.y,r.z=y?h.z:d.z,this.closestPointToPoint(r,i);const S=r.distanceToSquared(i);if(S<_&&(_=S,l&&l.copy(i),c&&c.copy(r),S<u))return Math.sqrt(S)}for(let g=0;g<12;g++){const m=e[g];for(let y=0;y<12;y++){const S=t[y];Ku(m,S,i,r);const M=i.distanceToSquared(r);if(M<_&&(_=M,l&&l.copy(i),c&&c.copy(r),M<u))return Math.sqrt(M)}}return Math.sqrt(_)}}();class fw extends Yu{constructor(){super(()=>new ei)}}const Gn=new fw,js=new z,rc=new z;function pw(n,e,t={},i=0,r=1/0){const s=i*i,o=r*r;let a=1/0,l=null;if(n.shapecast({boundsTraverseOrder:u=>(js.copy(e).clamp(u.min,u.max),js.distanceToSquared(e)),intersectsBounds:(u,d,h)=>h<a&&h<o,intersectsTriangle:(u,d)=>{u.closestPointToPoint(e,js);const h=e.distanceToSquared(js);return h<a&&(rc.copy(js),a=h,l=d),h<s}}),a===1/0)return null;const c=Math.sqrt(a);return t.point?t.point.copy(rc):t.point=rc.clone(),t.distance=c,t.faceIndex=l,t}const ca=parseInt(po)>=169,mw=parseInt(po)<=161,gr=new z,_r=new z,vr=new z,ua=new Xe,da=new Xe,ha=new Xe,hf=new z,ff=new z,pf=new z,qs=new z;function gw(n,e,t,i,r,s,o,a){let l;if(s===un?l=n.intersectTriangle(i,t,e,!0,r):l=n.intersectTriangle(e,t,i,s!==en,r),l===null)return null;const c=n.origin.distanceTo(r);return c<o||c>a?null:{distance:c,point:r.clone()}}function mf(n,e,t,i,r,s,o,a,l,c,u){gr.fromBufferAttribute(e,s),_r.fromBufferAttribute(e,o),vr.fromBufferAttribute(e,a);const d=gw(n,gr,_r,vr,qs,l,c,u);if(d){if(i){ua.fromBufferAttribute(i,s),da.fromBufferAttribute(i,o),ha.fromBufferAttribute(i,a),d.uv=new Xe;const f=tn.getInterpolation(qs,gr,_r,vr,ua,da,ha,d.uv);ca||(d.uv=f)}if(r){ua.fromBufferAttribute(r,s),da.fromBufferAttribute(r,o),ha.fromBufferAttribute(r,a),d.uv1=new Xe;const f=tn.getInterpolation(qs,gr,_r,vr,ua,da,ha,d.uv1);ca||(d.uv1=f),mw&&(d.uv2=d.uv1)}if(t){hf.fromBufferAttribute(t,s),ff.fromBufferAttribute(t,o),pf.fromBufferAttribute(t,a),d.normal=new z;const f=tn.getInterpolation(qs,gr,_r,vr,hf,ff,pf,d.normal);d.normal.dot(n.direction)>0&&d.normal.multiplyScalar(-1),ca||(d.normal=f)}const h={a:s,b:o,c:a,normal:new z,materialIndex:0};if(tn.getNormal(gr,_r,vr,h.normal),d.face=h,d.faceIndex=s,ca){const f=new z;tn.getBarycoord(qs,gr,_r,vr,f),d.barycoord=f}}return d}function gf(n){return n&&n.isMaterial?n.side:n}function Ka(n,e,t,i,r,s,o){const a=i*3;let l=a+0,c=a+1,u=a+2;const{index:d,groups:h}=n;n.index&&(l=d.getX(l),c=d.getX(c),u=d.getX(u));const{position:f,normal:_,uv:v,uv1:g}=n.attributes;if(Array.isArray(e)){const m=i*3;for(let y=0,S=h.length;y<S;y++){const{start:M,count:R,materialIndex:A}=h[y];if(m>=M&&m<M+R){const C=gf(e[A]),D=mf(t,f,_,v,g,l,c,u,C,s,o);if(D)if(D.faceIndex=i,D.face.materialIndex=A,r)r.push(D);else return D}}}else{const m=gf(e),y=mf(t,f,_,v,g,l,c,u,m,s,o);if(y)if(y.faceIndex=i,y.face.materialIndex=0,r)r.push(y);else return y}return null}function Ut(n,e,t,i){const r=n.a,s=n.b,o=n.c;let a=e,l=e+1,c=e+2;t&&(a=t.getX(a),l=t.getX(l),c=t.getX(c)),r.x=i.getX(a),r.y=i.getY(a),r.z=i.getZ(a),s.x=i.getX(l),s.y=i.getY(l),s.z=i.getZ(l),o.x=i.getX(c),o.y=i.getY(c),o.z=i.getZ(c)}function _w(n,e,t,i,r,s,o,a){const{geometry:l,_indirectBuffer:c}=n;for(let u=i,d=i+r;u<d;u++)Ka(l,e,t,u,s,o,a)}function vw(n,e,t,i,r,s,o){const{geometry:a,_indirectBuffer:l}=n;let c=1/0,u=null;for(let d=i,h=i+r;d<h;d++){let f;f=Ka(a,e,t,d,null,s,o),f&&f.distance<c&&(u=f,c=f.distance)}return u}function yw(n,e,t,i,r,s,o){const{geometry:a}=t,{index:l}=a,c=a.attributes.position;for(let u=n,d=e+n;u<d;u++){let h;if(h=u,Ut(o,h*3,l,c),o.needsUpdate=!0,i(o,h,r,s))return!0}return!1}function xw(n,e=null){e&&Array.isArray(e)&&(e=new Set(e));const t=n.geometry,i=t.index?t.index.array:null,r=t.attributes.position;let s,o,a,l,c=0;const u=n._roots;for(let h=0,f=u.length;h<f;h++)s=u[h],o=new Uint32Array(s),a=new Uint16Array(s),l=new Float32Array(s),d(0,c),c+=s.byteLength;function d(h,f,_=!1){const v=h*2;if(Vt(v,a)){const g=cn(h,o),m=_n(v,a);let y=1/0,S=1/0,M=1/0,R=-1/0,A=-1/0,C=-1/0;for(let D=3*g,$=3*(g+m);D<$;D++){let b=i[D];const E=r.getX(b),F=r.getY(b),O=r.getZ(b);E<y&&(y=E),E>R&&(R=E),F<S&&(S=F),F>A&&(A=F),O<M&&(M=O),O>C&&(C=O)}return l[h+0]!==y||l[h+1]!==S||l[h+2]!==M||l[h+3]!==R||l[h+4]!==A||l[h+5]!==C?(l[h+0]=y,l[h+1]=S,l[h+2]=M,l[h+3]=R,l[h+4]=A,l[h+5]=C,!0):!1}else{const g=Zt(h),m=Kt(h,o);let y=_,S=!1,M=!1;if(e){if(!y){const b=g/Ht+f/ln,E=m/Ht+f/ln;S=e.has(b),M=e.has(E),y=!S&&!M}}else S=!0,M=!0;const R=y||S,A=y||M;let C=!1;R&&(C=d(g,f,y));let D=!1;A&&(D=d(m,f,y));const $=C||D;if($)for(let b=0;b<3;b++){const E=g+b,F=m+b,O=l[E],X=l[E+3],re=l[F],K=l[F+3];l[h+b]=O<re?O:re,l[h+b+3]=X>K?X:K}return $}}}function ir(n,e,t,i,r){let s,o,a,l,c,u;const d=1/t.direction.x,h=1/t.direction.y,f=1/t.direction.z,_=t.origin.x,v=t.origin.y,g=t.origin.z;let m=e[n],y=e[n+3],S=e[n+1],M=e[n+3+1],R=e[n+2],A=e[n+3+2];return d>=0?(s=(m-_)*d,o=(y-_)*d):(s=(y-_)*d,o=(m-_)*d),h>=0?(a=(S-v)*h,l=(M-v)*h):(a=(M-v)*h,l=(S-v)*h),s>l||a>o||((a>s||isNaN(s))&&(s=a),(l<o||isNaN(o))&&(o=l),f>=0?(c=(R-g)*f,u=(A-g)*f):(c=(A-g)*f,u=(R-g)*f),s>u||c>o)?!1:((c>s||s!==s)&&(s=c),(u<o||o!==o)&&(o=u),s<=r&&o>=i)}function bw(n,e,t,i,r,s,o,a){const{geometry:l,_indirectBuffer:c}=n;for(let u=i,d=i+r;u<d;u++){let h=c?c[u]:u;Ka(l,e,t,h,s,o,a)}}function Sw(n,e,t,i,r,s,o){const{geometry:a,_indirectBuffer:l}=n;let c=1/0,u=null;for(let d=i,h=i+r;d<h;d++){let f;f=Ka(a,e,t,l?l[d]:d,null,s,o),f&&f.distance<c&&(u=f,c=f.distance)}return u}function Mw(n,e,t,i,r,s,o){const{geometry:a}=t,{index:l}=a,c=a.attributes.position;for(let u=n,d=e+n;u<d;u++){let h;if(h=t.resolveTriangleIndex(u),Ut(o,h*3,l,c),o.needsUpdate=!0,i(o,h,r,s))return!0}return!1}function ww(n,e,t,i,r,s,o){Mt.setBuffer(n._roots[e]),du(0,n,t,i,r,s,o),Mt.clearBuffer()}function du(n,e,t,i,r,s,o){const{float32Array:a,uint16Array:l,uint32Array:c}=Mt,u=n*2;if(Vt(u,l)){const h=cn(n,c),f=_n(u,l);_w(e,t,i,h,f,r,s,o)}else{const h=Zt(n);ir(h,a,i,s,o)&&du(h,e,t,i,r,s,o);const f=Kt(n,c);ir(f,a,i,s,o)&&du(f,e,t,i,r,s,o)}}const Ew=["x","y","z"];function Tw(n,e,t,i,r,s){Mt.setBuffer(n._roots[e]);const o=hu(0,n,t,i,r,s);return Mt.clearBuffer(),o}function hu(n,e,t,i,r,s){const{float32Array:o,uint16Array:a,uint32Array:l}=Mt;let c=n*2;if(Vt(c,a)){const d=cn(n,l),h=_n(c,a);return vw(e,t,i,d,h,r,s)}else{const d=qu(n,l),h=Ew[d],_=i.direction[h]>=0;let v,g;_?(v=Zt(n),g=Kt(n,l)):(v=Kt(n,l),g=Zt(n));const y=ir(v,o,i,r,s)?hu(v,e,t,i,r,s):null;if(y){const R=y.point[h];if(_?R<=o[g+d]:R>=o[g+d+3])return y}const M=ir(g,o,i,r,s)?hu(g,e,t,i,r,s):null;return y&&M?y.distance<=M.distance?y:M:y||M||null}}const fa=new $t,ns=new ei,is=new ei,Ys=new ht,_f=new yn,pa=new yn;function Aw(n,e,t,i){Mt.setBuffer(n._roots[e]);const r=fu(0,n,t,i);return Mt.clearBuffer(),r}function fu(n,e,t,i,r=null){const{float32Array:s,uint16Array:o,uint32Array:a}=Mt;let l=n*2;if(r===null&&(t.boundingBox||t.computeBoundingBox(),_f.set(t.boundingBox.min,t.boundingBox.max,i),r=_f),Vt(l,o)){const u=e.geometry,d=u.index,h=u.attributes.position,f=t.index,_=t.attributes.position,v=cn(n,a),g=_n(l,o);if(Ys.copy(i).invert(),t.boundsTree)return At(n,s,pa),pa.matrix.copy(Ys),pa.needsUpdate=!0,t.boundsTree.shapecast({intersectsBounds:y=>pa.intersectsBox(y),intersectsTriangle:y=>{y.a.applyMatrix4(i),y.b.applyMatrix4(i),y.c.applyMatrix4(i),y.needsUpdate=!0;for(let S=v*3,M=(g+v)*3;S<M;S+=3)if(Ut(is,S,d,h),is.needsUpdate=!0,y.intersectsTriangle(is))return!0;return!1}});{const m=Za(t);for(let y=v*3,S=(g+v)*3;y<S;y+=3){Ut(ns,y,d,h),ns.a.applyMatrix4(Ys),ns.b.applyMatrix4(Ys),ns.c.applyMatrix4(Ys),ns.needsUpdate=!0;for(let M=0,R=m*3;M<R;M+=3)if(Ut(is,M,f,_),is.needsUpdate=!0,ns.intersectsTriangle(is))return!0}}}else{const u=Zt(n),d=Kt(n,a);return At(u,s,fa),!!(r.intersectsBox(fa)&&fu(u,e,t,i,r)||(At(d,s,fa),r.intersectsBox(fa)&&fu(d,e,t,i,r)))}}const ma=new ht,sc=new yn,Zs=new yn,Cw=new z,Pw=new z,Rw=new z,Lw=new z;function Iw(n,e,t,i={},r={},s=0,o=1/0){e.boundingBox||e.computeBoundingBox(),sc.set(e.boundingBox.min,e.boundingBox.max,t),sc.needsUpdate=!0;const a=n.geometry,l=a.attributes.position,c=a.index,u=e.attributes.position,d=e.index,h=Gn.getPrimitive(),f=Gn.getPrimitive();let _=Cw,v=Pw,g=null,m=null;r&&(g=Rw,m=Lw);let y=1/0,S=null,M=null;return ma.copy(t).invert(),Zs.matrix.copy(ma),n.shapecast({boundsTraverseOrder:R=>sc.distanceToBox(R),intersectsBounds:(R,A,C)=>C<y&&C<o?(A&&(Zs.min.copy(R.min),Zs.max.copy(R.max),Zs.needsUpdate=!0),!0):!1,intersectsRange:(R,A)=>{if(e.boundsTree)return e.boundsTree.shapecast({boundsTraverseOrder:D=>Zs.distanceToBox(D),intersectsBounds:(D,$,b)=>b<y&&b<o,intersectsRange:(D,$)=>{for(let b=D,E=D+$;b<E;b++){Ut(f,3*b,d,u),f.a.applyMatrix4(t),f.b.applyMatrix4(t),f.c.applyMatrix4(t),f.needsUpdate=!0;for(let F=R,O=R+A;F<O;F++){Ut(h,3*F,c,l),h.needsUpdate=!0;const X=h.distanceToTriangle(f,_,g);if(X<y&&(v.copy(_),m&&m.copy(g),y=X,S=F,M=b),X<s)return!0}}}});{const C=Za(e);for(let D=0,$=C;D<$;D++){Ut(f,3*D,d,u),f.a.applyMatrix4(t),f.b.applyMatrix4(t),f.c.applyMatrix4(t),f.needsUpdate=!0;for(let b=R,E=R+A;b<E;b++){Ut(h,3*b,c,l),h.needsUpdate=!0;const F=h.distanceToTriangle(f,_,g);if(F<y&&(v.copy(_),m&&m.copy(g),y=F,S=b,M=D),F<s)return!0}}}}}),Gn.releasePrimitive(h),Gn.releasePrimitive(f),y===1/0?null:(i.point?i.point.copy(v):i.point=v.clone(),i.distance=y,i.faceIndex=S,r&&(r.point?r.point.copy(m):r.point=m.clone(),r.point.applyMatrix4(ma),v.applyMatrix4(ma),r.distance=v.sub(r.point).length(),r.faceIndex=M),i)}function Dw(n,e=null){e&&Array.isArray(e)&&(e=new Set(e));const t=n.geometry,i=t.index?t.index.array:null,r=t.attributes.position;let s,o,a,l,c=0;const u=n._roots;for(let h=0,f=u.length;h<f;h++)s=u[h],o=new Uint32Array(s),a=new Uint16Array(s),l=new Float32Array(s),d(0,c),c+=s.byteLength;function d(h,f,_=!1){const v=h*2;if(Vt(v,a)){const g=cn(h,o),m=_n(v,a);let y=1/0,S=1/0,M=1/0,R=-1/0,A=-1/0,C=-1/0;for(let D=g,$=g+m;D<$;D++){const b=3*n.resolveTriangleIndex(D);for(let E=0;E<3;E++){let F=b+E;F=i?i[F]:F;const O=r.getX(F),X=r.getY(F),re=r.getZ(F);O<y&&(y=O),O>R&&(R=O),X<S&&(S=X),X>A&&(A=X),re<M&&(M=re),re>C&&(C=re)}}return l[h+0]!==y||l[h+1]!==S||l[h+2]!==M||l[h+3]!==R||l[h+4]!==A||l[h+5]!==C?(l[h+0]=y,l[h+1]=S,l[h+2]=M,l[h+3]=R,l[h+4]=A,l[h+5]=C,!0):!1}else{const g=Zt(h),m=Kt(h,o);let y=_,S=!1,M=!1;if(e){if(!y){const b=g/Ht+f/ln,E=m/Ht+f/ln;S=e.has(b),M=e.has(E),y=!S&&!M}}else S=!0,M=!0;const R=y||S,A=y||M;let C=!1;R&&(C=d(g,f,y));let D=!1;A&&(D=d(m,f,y));const $=C||D;if($)for(let b=0;b<3;b++){const E=g+b,F=m+b,O=l[E],X=l[E+3],re=l[F],K=l[F+3];l[h+b]=O<re?O:re,l[h+b+3]=X>K?X:K}return $}}}function Nw(n,e,t,i,r,s,o){Mt.setBuffer(n._roots[e]),pu(0,n,t,i,r,s,o),Mt.clearBuffer()}function pu(n,e,t,i,r,s,o){const{float32Array:a,uint16Array:l,uint32Array:c}=Mt,u=n*2;if(Vt(u,l)){const h=cn(n,c),f=_n(u,l);bw(e,t,i,h,f,r,s,o)}else{const h=Zt(n);ir(h,a,i,s,o)&&pu(h,e,t,i,r,s,o);const f=Kt(n,c);ir(f,a,i,s,o)&&pu(f,e,t,i,r,s,o)}}const Uw=["x","y","z"];function Fw(n,e,t,i,r,s){Mt.setBuffer(n._roots[e]);const o=mu(0,n,t,i,r,s);return Mt.clearBuffer(),o}function mu(n,e,t,i,r,s){const{float32Array:o,uint16Array:a,uint32Array:l}=Mt;let c=n*2;if(Vt(c,a)){const d=cn(n,l),h=_n(c,a);return Sw(e,t,i,d,h,r,s)}else{const d=qu(n,l),h=Uw[d],_=i.direction[h]>=0;let v,g;_?(v=Zt(n),g=Kt(n,l)):(v=Kt(n,l),g=Zt(n));const y=ir(v,o,i,r,s)?mu(v,e,t,i,r,s):null;if(y){const R=y.point[h];if(_?R<=o[g+d]:R>=o[g+d+3])return y}const M=ir(g,o,i,r,s)?mu(g,e,t,i,r,s):null;return y&&M?y.distance<=M.distance?y:M:y||M||null}}const ga=new $t,rs=new ei,ss=new ei,Ks=new ht,vf=new yn,_a=new yn;function Ow(n,e,t,i){Mt.setBuffer(n._roots[e]);const r=gu(0,n,t,i);return Mt.clearBuffer(),r}function gu(n,e,t,i,r=null){const{float32Array:s,uint16Array:o,uint32Array:a}=Mt;let l=n*2;if(r===null&&(t.boundingBox||t.computeBoundingBox(),vf.set(t.boundingBox.min,t.boundingBox.max,i),r=vf),Vt(l,o)){const u=e.geometry,d=u.index,h=u.attributes.position,f=t.index,_=t.attributes.position,v=cn(n,a),g=_n(l,o);if(Ks.copy(i).invert(),t.boundsTree)return At(n,s,_a),_a.matrix.copy(Ks),_a.needsUpdate=!0,t.boundsTree.shapecast({intersectsBounds:y=>_a.intersectsBox(y),intersectsTriangle:y=>{y.a.applyMatrix4(i),y.b.applyMatrix4(i),y.c.applyMatrix4(i),y.needsUpdate=!0;for(let S=v,M=g+v;S<M;S++)if(Ut(ss,3*e.resolveTriangleIndex(S),d,h),ss.needsUpdate=!0,y.intersectsTriangle(ss))return!0;return!1}});{const m=Za(t);for(let y=v,S=g+v;y<S;y++){const M=e.resolveTriangleIndex(y);Ut(rs,3*M,d,h),rs.a.applyMatrix4(Ks),rs.b.applyMatrix4(Ks),rs.c.applyMatrix4(Ks),rs.needsUpdate=!0;for(let R=0,A=m*3;R<A;R+=3)if(Ut(ss,R,f,_),ss.needsUpdate=!0,rs.intersectsTriangle(ss))return!0}}}else{const u=Zt(n),d=Kt(n,a);return At(u,s,ga),!!(r.intersectsBox(ga)&&gu(u,e,t,i,r)||(At(d,s,ga),r.intersectsBox(ga)&&gu(d,e,t,i,r)))}}const va=new ht,oc=new yn,Js=new yn,Bw=new z,kw=new z,zw=new z,Hw=new z;function Vw(n,e,t,i={},r={},s=0,o=1/0){e.boundingBox||e.computeBoundingBox(),oc.set(e.boundingBox.min,e.boundingBox.max,t),oc.needsUpdate=!0;const a=n.geometry,l=a.attributes.position,c=a.index,u=e.attributes.position,d=e.index,h=Gn.getPrimitive(),f=Gn.getPrimitive();let _=Bw,v=kw,g=null,m=null;r&&(g=zw,m=Hw);let y=1/0,S=null,M=null;return va.copy(t).invert(),Js.matrix.copy(va),n.shapecast({boundsTraverseOrder:R=>oc.distanceToBox(R),intersectsBounds:(R,A,C)=>C<y&&C<o?(A&&(Js.min.copy(R.min),Js.max.copy(R.max),Js.needsUpdate=!0),!0):!1,intersectsRange:(R,A)=>{if(e.boundsTree){const C=e.boundsTree;return C.shapecast({boundsTraverseOrder:D=>Js.distanceToBox(D),intersectsBounds:(D,$,b)=>b<y&&b<o,intersectsRange:(D,$)=>{for(let b=D,E=D+$;b<E;b++){const F=C.resolveTriangleIndex(b);Ut(f,3*F,d,u),f.a.applyMatrix4(t),f.b.applyMatrix4(t),f.c.applyMatrix4(t),f.needsUpdate=!0;for(let O=R,X=R+A;O<X;O++){const re=n.resolveTriangleIndex(O);Ut(h,3*re,c,l),h.needsUpdate=!0;const K=h.distanceToTriangle(f,_,g);if(K<y&&(v.copy(_),m&&m.copy(g),y=K,S=O,M=b),K<s)return!0}}}})}else{const C=Za(e);for(let D=0,$=C;D<$;D++){Ut(f,3*D,d,u),f.a.applyMatrix4(t),f.b.applyMatrix4(t),f.c.applyMatrix4(t),f.needsUpdate=!0;for(let b=R,E=R+A;b<E;b++){const F=n.resolveTriangleIndex(b);Ut(h,3*F,c,l),h.needsUpdate=!0;const O=h.distanceToTriangle(f,_,g);if(O<y&&(v.copy(_),m&&m.copy(g),y=O,S=b,M=D),O<s)return!0}}}}}),Gn.releasePrimitive(h),Gn.releasePrimitive(f),y===1/0?null:(i.point?i.point.copy(v):i.point=v.clone(),i.distance=y,i.faceIndex=S,r&&(r.point?r.point.copy(m):r.point=m.clone(),r.point.applyMatrix4(va),v.applyMatrix4(va),r.distance=v.sub(r.point).length(),r.faceIndex=M),i)}function yf(n,e,t){return n===null?null:(n.point.applyMatrix4(e.matrixWorld),n.distance=n.point.distanceTo(t.ray.origin),n.object=e,n)}const ya=new yn,xa=new Ri,xf=new z,bf=new ht,Sf=new z,ac=["getX","getY","getZ"];class Va extends cw{static serialize(e,t={}){t={cloneBuffers:!0,...t};const i=e.geometry,r=e._roots,s=e._indirectBuffer,o=i.getIndex(),a={version:1,roots:null,index:null,indirectBuffer:null};return t.cloneBuffers?(a.roots=r.map(l=>l.slice()),a.index=o?o.array.slice():null,a.indirectBuffer=s?s.slice():null):(a.roots=r,a.index=o?o.array:null,a.indirectBuffer=s),a}static deserialize(e,t,i={}){i={setIndex:!0,indirect:!!e.indirectBuffer,...i};const{index:r,roots:s,indirectBuffer:o}=e;e.version||(console.warn("MeshBVH.deserialize: Serialization format has been changed and will be fixed up. It is recommended to regenerate any stored serialized data."),l(s));const a=new Va(t,{...i,[ju]:!0});if(a._roots=s,a._indirectBuffer=o||null,i.setIndex){const c=t.getIndex();if(c===null){const u=new pt(e.index,1,!1);t.setIndex(u)}else c.array!==r&&(c.array.set(r),c.needsUpdate=!0)}return a;function l(c){for(let u=0;u<c.length;u++){const d=c[u],h=new Uint32Array(d),f=new Uint16Array(d);for(let _=0,v=d.byteLength/ln;_<v;_++){const g=Ht*_,m=2*g;Vt(m,f)||(h[g+6]=h[g+6]/Ht-_)}}}}get primitiveStride(){return 3}get resolveTriangleIndex(){return this.resolvePrimitiveIndex}constructor(e,t={}){t.maxLeafTris&&(console.warn('MeshBVH: "maxLeafTris" option has been deprecated. Use maxLeafSize, instead.'),t={...t,maxLeafSize:t.maxLeafTris}),super(e,t)}shiftTriangleOffsets(e){return super.shiftPrimitiveOffsets(e)}writePrimitiveBounds(e,t,i){const r=this.geometry,s=this._indirectBuffer,o=r.attributes.position,a=r.index?r.index.array:null,c=(s?s[e]:e)*3;let u=c+0,d=c+1,h=c+2;a&&(u=a[u],d=a[d],h=a[h]);for(let f=0;f<3;f++){const _=o[ac[f]](u),v=o[ac[f]](d),g=o[ac[f]](h);let m=_;v<m&&(m=v),g<m&&(m=g);let y=_;v>y&&(y=v),g>y&&(y=g),t[i+f]=m,t[i+f+3]=y}return t}computePrimitiveBounds(e,t,i){const r=this.geometry,s=this._indirectBuffer,o=r.attributes.position,a=r.index?r.index.array:null,l=o.normalized;if(e<0||t+e-i.offset>i.length/6)throw new Error("MeshBVH: compute triangle bounds range is invalid.");const c=o.array,u=o.offset||0;let d=3;o.isInterleavedBufferAttribute&&(d=o.data.stride);const h=["getX","getY","getZ"],f=i.offset;for(let _=e,v=e+t;_<v;_++){const m=(s?s[_]:_)*3,y=(_-f)*6;let S=m+0,M=m+1,R=m+2;a&&(S=a[S],M=a[M],R=a[R]),l||(S=S*d+u,M=M*d+u,R=R*d+u);for(let A=0;A<3;A++){let C,D,$;l?(C=o[h[A]](S),D=o[h[A]](M),$=o[h[A]](R)):(C=c[S+A],D=c[M+A],$=c[R+A]);let b=C;D<b&&(b=D),$<b&&(b=$);let E=C;D>E&&(E=D),$>E&&(E=$);const F=(E-b)/2,O=A*2;i[y+O+0]=b+F,i[y+O+1]=F+(Math.abs(b)+F)*La}}return i}raycastObject3D(e,t,i=[]){const{material:r}=e;if(r===void 0)return;bf.copy(e.matrixWorld).invert(),xa.copy(t.ray).applyMatrix4(bf),Sf.setFromMatrixScale(e.matrixWorld),xf.copy(xa.direction).multiply(Sf);const s=xf.length(),o=t.near/s,a=t.far/s;if(t.firstHitOnly===!0){let l=this.raycastFirst(xa,r,o,a);l=yf(l,e,t),l&&i.push(l)}else{const l=this.raycast(xa,r,o,a);for(let c=0,u=l.length;c<u;c++){const d=yf(l[c],e,t);d&&i.push(d)}}return i}refit(e=null){return(this.indirect?Dw:xw)(this,e)}raycast(e,t=In,i=0,r=1/0){const s=this._roots,o=[],a=this.indirect?Nw:ww;for(let l=0,c=s.length;l<c;l++)a(this,l,t,e,o,i,r);return o}raycastFirst(e,t=In,i=0,r=1/0){const s=this._roots;let o=null;const a=this.indirect?Fw:Tw;for(let l=0,c=s.length;l<c;l++){const u=a(this,l,t,e,i,r);u!=null&&(o==null||u.distance<o.distance)&&(o=u)}return o}intersectsGeometry(e,t){let i=!1;const r=this._roots,s=this.indirect?Ow:Aw;for(let o=0,a=r.length;o<a&&(i=s(this,o,e,t),!i);o++);return i}shapecast(e){const t=Gn.getPrimitive(),i=super.shapecast({...e,intersectsPrimitive:e.intersectsTriangle,scratchPrimitive:t,iterate:this.indirect?Mw:yw});return Gn.releasePrimitive(t),i}bvhcast(e,t,i){let{intersectsRanges:r,intersectsTriangles:s}=i;const o=Gn.getPrimitive(),a=this.geometry.index,l=this.geometry.attributes.position,c=this.indirect?_=>{const v=this.resolveTriangleIndex(_);Ut(o,v*3,a,l)}:_=>{Ut(o,_*3,a,l)},u=Gn.getPrimitive(),d=e.geometry.index,h=e.geometry.attributes.position,f=e.indirect?_=>{const v=e.resolveTriangleIndex(_);Ut(u,v*3,d,h)}:_=>{Ut(u,_*3,d,h)};if(s){if(!(e instanceof Va))throw new Error('MeshBVH: "intersectsTriangles" callback can only be used with another MeshBVH.');const _=(v,g,m,y,S,M,R,A)=>{for(let C=m,D=m+y;C<D;C++){f(C),u.a.applyMatrix4(t),u.b.applyMatrix4(t),u.c.applyMatrix4(t),u.needsUpdate=!0;for(let $=v,b=v+g;$<b;$++)if(c($),o.needsUpdate=!0,s(o,u,$,C,S,M,R,A))return!0}return!1};if(r){const v=r;r=function(g,m,y,S,M,R,A,C){return v(g,m,y,S,M,R,A,C)?!0:_(g,m,y,S,M,R,A,C)}}else r=_}return super.bvhcast(e,t,{intersectsRanges:r})}intersectsBox(e,t){return ya.set(e.min,e.max,t),ya.needsUpdate=!0,this.shapecast({intersectsBounds:i=>ya.intersectsBox(i),intersectsTriangle:i=>ya.intersectsTriangle(i)})}intersectsSphere(e){return this.shapecast({intersectsBounds:t=>e.intersectsBox(t),intersectsTriangle:t=>t.intersectsSphere(e)})}closestPointToGeometry(e,t,i={},r={},s=0,o=1/0){return(this.indirect?Vw:Iw)(this,e,t,i,r,s,o)}closestPointToPoint(e,t={},i=0,r=1/0){return pw(this,e,t,i,r)}}const Xi=new $t,lc=new $t,ii=new di,Mf=new z,wf=new z,ji=new z,Qs=new z;function Gw(n,e){return n.max.x>=e.minX&&n.min.x<=e.maxX&&n.max.z>=e.minZ&&n.min.z<=e.maxZ}function Ww(n){const e=new Ct;return e.setAttribute("position",new pt(n.positions,3)),e.setIndex(new pt(n.indices,1)),e}function Ef(n,e){return lc.min.set(e.minX,-1e4,e.minZ),lc.max.set(e.maxX,1e4,e.maxZ),n.intersectsBox(lc)}class $w{entries;constructor(e){this.entries=e.map(t=>{if(!t.geometry&&!t.mesh)throw new Error(`Collider page ${t.id} needs geometry or mesh source`);return{id:t.id,footprint:t.footprint,sourceGeometry:t.geometry?.clone()??null,sourceMesh:t.mesh??null,geometry:null,boundsTree:null}})}loadedPageCount(){return this.entries.filter(e=>e.boundsTree!==null).length}ensureEntry(e){if(e.boundsTree)return e.boundsTree;const t=e.sourceGeometry?.clone()??(e.sourceMesh?Ww(e.sourceMesh):null);if(!t)throw new Error(`Collider page ${e.id} has no source geometry`);return t.computeBoundingBox(),e.geometry=t,e.boundsTree=new Va(t),e.boundsTree}raycastSpawn(e){let t=null,i=Number.POSITIVE_INFINITY;for(const r of this.entries){if(!Ef(e,r.footprint))continue;const s=this.ensureEntry(r).raycastFirst(e,en);if(!s||s.distance>=i||!s.face)continue;const o=s.face.normal.clone().normalize();o.y<0&&o.negate(),!(o.y<=.01)&&(i=s.distance,t={point:s.point.clone(),normal:o,pageId:r.id})}return t}raycastSurface(e){let t=null;for(const i of this.entries){if(!Ef(e,i.footprint))continue;const r=this.ensureEntry(i).raycastFirst(e,en);r&&(!t||r.distance<t.distance)&&(t={point:r.point.clone(),distance:r.distance,pageId:i.id})}return t}updatePage(e,t){const i=this.entries.find(s=>s.id===e);if(!i)return!1;const r=i.boundsTree!==null;return i.geometry?.dispose(),i.sourceGeometry?.dispose(),i.geometry=null,i.boundsTree=null,t instanceof Ct?(i.sourceGeometry=t.clone(),i.sourceMesh=null):(i.sourceGeometry=null,i.sourceMesh=t),r&&this.ensureEntry(i),!0}resolveCapsule(e,t,i){const r=i.capsuleRadius;ii.start.set(e.x,e.y+r,e.z),ii.end.set(e.x,e.y+i.capsuleHeight-r,e.z),Xi.makeEmpty(),Xi.expandByPoint(ii.start),Xi.expandByPoint(ii.end),Xi.min.addScalar(-r),Xi.max.addScalar(r);const s=Math.cos(Nt.degToRad(i.maxSlopeDegrees));let o=!1,a=0;for(const d of this.entries)Gw(Xi,d.footprint)&&(a++,this.ensureEntry(d).shapecast({intersectsBounds:h=>h.intersectsBox(Xi),intersectsTriangle:h=>{const f=h.closestPointToSegment(ii,Mf,wf);if(f>=r)return!1;h.getNormal(Qs),Qs.y<0&&Qs.negate();const _=r-f;return ji.subVectors(wf,Mf),ji.lengthSq()<1e-10?ji.copy(Qs):ji.normalize(),ii.start.addScaledVector(ji,_),ii.end.addScaledVector(ji,_),Xi.translate(ji.clone().multiplyScalar(_)),Qs.y>=s&&ji.y>.01&&(o=!0),!1}}));const l=new z(ii.start.x,ii.start.y-r,ii.start.z),c=l.clone().sub(e),u=t.clone();if(c.lengthSq()>1e-10){const d=c.normalize(),h=u.dot(d);h<0&&u.addScaledVector(d,-h)}return o&&u.y<0&&(u.y=0),{position:l,velocity:u,grounded:o,pagesTested:a}}dispose(){for(const e of this.entries)e.geometry?.dispose(),e.sourceGeometry?.dispose(),e.geometry=null,e.sourceGeometry=null,e.boundsTree=null}}function tm(n){return n.positions.length/3}function Xw(n,e){const t=Math.min(n,e),i=Math.max(n,e);return t*16777216+i}function jw(n){const e=new Map,t=n.indices;for(let r=0;r<t.length;r+=3){const s=t[r],o=t[r+1],a=t[r+2];for(const[l,c]of[[s,o],[o,a],[a,s]]){const u=Xw(l,c);e.set(u,(e.get(u)??0)+1)}}const i=new Set;for(const[r,s]of e)s===1&&i.add(r);return i}function nm(n){const e=new Uint8Array(tm(n));for(const t of jw(n))e[Math.floor(t/16777216)]=1,e[t%16777216]=1;return e}const eo=1;function _u(n,e,t,i){const r=tm(n),s=nm(n),o=[];for(let l=0;l<r;l++){if(!s[l])continue;const c=n.positions[l*3],u=n.positions[l*3+2];if(!(Math.abs((e==="x"?c:u)-t)>eo)){if(e==="x"){if(Math.abs(u-i.minZ)<=eo||Math.abs(u-i.maxZ)<=eo)continue}else if(Math.abs(c-i.minX)<=eo||Math.abs(c-i.maxX)<=eo)continue;o.push({p:[n.positions[l*3],n.positions[l*3+1],n.positions[l*3+2]],nr:[n.normals[l*3],n.normals[l*3+1],n.normals[l*3+2]],m:n.materials[l]})}}const a=e==="x"?2:0;return o.sort((l,c)=>l.p[a]-c.p[a]||l.p[1]-c.p[1]),{positions:o.map(l=>l.p),normals:o.map(l=>l.nr),materials:o.map(l=>l.m)}}const Kn={sunAzimuthDeg:128,sunElevationDeg:55,sunIntensity:1,skyIntensity:1,groundIntensity:1,exposure:1.05,horizonSoftness:.72,sunDiskIntensity:1,sunGlowIntensity:1,hazeIntensity:.22},qw={sun:new Ke(.95,.86,.68),zenith:new Ke(4681119),horizon:new Ke(12569042),ground:new Ke(3683112),skyLight:new Ke(7043732),groundLight:new Ke(3025185)},Yw=`
  varying vec3 vDir;

  void main() {
    vDir = normalize(position);
    vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = clip.xyww;
  }
`,Zw=`
  precision highp float;
  uniform vec3 uSunDir;
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uGround;
  uniform vec3 uSunColor;
  uniform float uSkyIntensity;
  uniform float uGroundIntensity;
  uniform float uHorizonSoftness;
  uniform float uSunDiskIntensity;
  uniform float uSunGlowIntensity;
  uniform float uHazeIntensity;
  varying vec3 vDir;

  void main() {
    vec3 dir = normalize(vDir);
    float up = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
    float skyGradient = pow(up, max(uHorizonSoftness, 0.01));
    vec3 upperSky = mix(uHorizon, uZenith, skyGradient) * uSkyIntensity;
    float groundBlend = smoothstep(-0.18, 0.03, dir.y);
    vec3 sky = mix(uGround * uGroundIntensity, upperSky, groundBlend);

    float haze = exp(-abs(dir.y) * 12.0) * uHazeIntensity;
    sky = mix(sky, uHorizon * uSkyIntensity, clamp(haze, 0.0, 1.0));

    float sunDot = max(dot(dir, normalize(uSunDir)), 0.0);
    float aboveHorizon = smoothstep(-0.02, 0.02, dir.y);
    float sunDisk = smoothstep(0.9995, 0.9999, sunDot) * uSunDiskIntensity;
    float sunGlow = pow(sunDot, 18.0) * 0.18 * uSunGlowIntensity;
    sky += uSunColor * (sunDisk + sunGlow) * aboveHorizon;

    gl_FragColor = vec4(sky, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;function Tf(n,e){const t=Nt.degToRad(n),i=Nt.degToRad(e),r=Math.cos(i);return new z(Math.cos(t)*r,Math.sin(i),Math.sin(t)*r).normalize()}class Kw{scene;renderer;mesh;previousBackground;background=new Ke;settings;colors;disposed=!1;constructor(e){this.scene=e.scene,this.renderer=e.renderer,this.settings={...e.settings},this.colors={sun:e.colors.sun.clone(),zenith:e.colors.zenith.clone(),horizon:e.colors.horizon.clone(),ground:e.colors.ground.clone(),skyLight:e.colors.skyLight.clone(),groundLight:e.colors.groundLight.clone()},this.previousBackground=this.scene.background;const t=new Dn({uniforms:{uSunDir:{value:new z},uZenith:{value:this.colors.zenith.clone()},uHorizon:{value:this.colors.horizon.clone()},uGround:{value:this.colors.ground.clone()},uSunColor:{value:this.colors.sun.clone()},uSkyIntensity:{value:this.settings.skyIntensity},uGroundIntensity:{value:this.settings.groundIntensity},uHorizonSoftness:{value:this.settings.horizonSoftness},uSunDiskIntensity:{value:this.settings.sunDiskIntensity},uSunGlowIntensity:{value:this.settings.sunGlowIntensity},uHazeIntensity:{value:this.settings.hazeIntensity}},vertexShader:Yw,fragmentShader:Zw,side:un,depthTest:!1,depthWrite:!1,toneMapped:!0});this.mesh=new gn(new ja(e.radius,48,24),t),this.mesh.name="sky-environment",this.mesh.frustumCulled=!1,this.mesh.renderOrder=-1e3,this.scene.add(this.mesh),this.updateColors(this.colors),this.updateSettings(this.settings)}updateSettings(e){Object.assign(this.settings,e);const t=this.mesh.material.uniforms;t.uSunDir.value.copy(Tf(this.settings.sunAzimuthDeg,this.settings.sunElevationDeg)),t.uSunColor.value.copy(this.colors.sun).multiplyScalar(this.settings.sunIntensity),t.uSkyIntensity.value=this.settings.skyIntensity,t.uGroundIntensity.value=this.settings.groundIntensity,t.uHorizonSoftness.value=this.settings.horizonSoftness,t.uSunDiskIntensity.value=this.settings.sunDiskIntensity,t.uSunGlowIntensity.value=this.settings.sunGlowIntensity,t.uHazeIntensity.value=this.settings.hazeIntensity,this.renderer.toneMappingExposure=this.settings.exposure,this.background.copy(this.colors.horizon).multiplyScalar(this.settings.skyIntensity),this.scene.background=this.background}updateColors(e){e.sun&&this.colors.sun.copy(e.sun),e.zenith&&this.colors.zenith.copy(e.zenith),e.horizon&&this.colors.horizon.copy(e.horizon),e.ground&&this.colors.ground.copy(e.ground),e.skyLight&&this.colors.skyLight.copy(e.skyLight),e.groundLight&&this.colors.groundLight.copy(e.groundLight);const t=this.mesh.material.uniforms;t.uSunColor.value.copy(this.colors.sun).multiplyScalar(this.settings.sunIntensity),t.uZenith.value.copy(this.colors.zenith),t.uHorizon.value.copy(this.colors.horizon),t.uGround.value.copy(this.colors.ground),this.background.copy(this.colors.horizon).multiplyScalar(this.settings.skyIntensity),this.scene.background=this.background}updateCamera(e){this.mesh.position.copy(e.position)}setVisible(e){this.mesh.visible=e}lighting(){return{sunDirection:Tf(this.settings.sunAzimuthDeg,this.settings.sunElevationDeg),sunColor:this.colors.sun.clone().multiplyScalar(this.settings.sunIntensity),skyLight:this.colors.skyLight.clone().multiplyScalar(this.settings.skyIntensity),groundLight:this.colors.groundLight.clone().multiplyScalar(this.settings.groundIntensity)}}dispose(){this.disposed||(this.disposed=!0,this.scene.remove(this.mesh),this.mesh.geometry.dispose(),this.mesh.material.dispose(),this.scene.background===this.background&&(this.scene.background=this.previousBackground))}}const wn={enabled:!0,opacity:1,exposure:1,contrast:1,saturation:1,vignette:0,debugMode:"output"},Af=`
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`,Jw=`
  uniform sampler2D tDiffuse;
  uniform float uOpacity;
  varying vec2 vUv;

  void main() {
    vec4 color = texture2D(tDiffuse, vUv);
    gl_FragColor = vec4(color.rgb, color.a * uOpacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`,Qw=`
  uniform sampler2D tDiffuse;
  uniform float uExposure;
  uniform float uContrast;
  uniform float uSaturation;
  uniform float uVignette;
  varying vec2 vUv;

  void main() {
    vec4 sampled = texture2D(tDiffuse, vUv);
    vec3 color = sampled.rgb * uExposure;
    color = (color - 0.5) * uContrast + 0.5;

    float luma = dot(color, vec3(0.299, 0.587, 0.114));
    color = mix(vec3(luma), color, uSaturation);

    vec2 center = vUv - 0.5;
    float vignetteMask = smoothstep(0.2, 0.75, length(center));
    color *= 1.0 - uVignette * vignetteMask;
    color = max(color, vec3(0.0));

    gl_FragColor = vec4(color, sampled.a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;function eE(){const n=new Ct;return n.setAttribute("position",new Ft([-1,-1,0,3,-1,0,-1,3,0],3)),n.setAttribute("uv",new Ft([0,0,2,0,0,2],2)),n}class tE{renderer;target;fullscreenScene=new bp;fullscreenCamera=new mp(-1,1,1,-1,0,1);fullscreenGeometry=eE();copyMaterial;outputMaterial;fullscreenMesh;drawingBufferSize=new Xe;settings;constructor(e,t){this.renderer=e,this.settings={...t},this.target=new nr(1,1,{depthBuffer:!0,stencilBuffer:!1}),this.target.texture.name="clod-poc-postprocess-color",this.copyMaterial=new Dn({uniforms:{tDiffuse:{value:this.target.texture},uOpacity:{value:t.opacity}},vertexShader:Af,fragmentShader:Jw,depthTest:!1,depthWrite:!1,transparent:!0,toneMapped:!0}),this.outputMaterial=new Dn({uniforms:{tDiffuse:{value:this.target.texture},uExposure:{value:t.exposure},uContrast:{value:t.contrast},uSaturation:{value:t.saturation},uVignette:{value:t.vignette}},vertexShader:Af,fragmentShader:Qw,depthTest:!1,depthWrite:!1,toneMapped:!0}),this.fullscreenMesh=new gn(this.fullscreenGeometry,this.outputMaterial),this.fullscreenMesh.frustumCulled=!1,this.fullscreenScene.add(this.fullscreenMesh),this.updateSettings(t)}setSize(e,t){this.renderer.getDrawingBufferSize(this.drawingBufferSize);const i=this.renderer.getPixelRatio(),r=this.drawingBufferSize.x||Math.floor(e*i),s=this.drawingBufferSize.y||Math.floor(t*i);this.target.setSize(Math.max(1,r),Math.max(1,s))}updateSettings(e){this.settings={...this.settings,...e},this.copyMaterial.uniforms.uOpacity.value=this.settings.opacity,this.outputMaterial.uniforms.uExposure.value=this.settings.exposure,this.outputMaterial.uniforms.uContrast.value=this.settings.contrast,this.outputMaterial.uniforms.uSaturation.value=this.settings.saturation,this.outputMaterial.uniforms.uVignette.value=this.settings.vignette}render(e,t){if(!this.settings.enabled||this.settings.debugMode==="off"){this.renderer.setRenderTarget(null),this.renderer.render(e,t);return}this.renderer.setRenderTarget(this.target),this.renderer.render(e,t),this.renderer.setRenderTarget(null),this.fullscreenMesh.material=this.settings.debugMode==="copy"?this.copyMaterial:this.outputMaterial,this.renderer.render(this.fullscreenScene,this.fullscreenCamera)}dispose(){this.target.dispose(),this.fullscreenGeometry.dispose(),this.copyMaterial.dispose(),this.outputMaterial.dispose()}}const im=1,vu="project.json",yu="terrain.glb",nE="drusniel-clod-imports",Es="projects",iE=["thresholdPx","divergenceGain","textureScale","normalIntensity","roughness","metalness","textureBlendWidth","terrainBrightness","terrainContrast","terrainSaturation","terrainWarmth","sunAzimuthDeg","sunElevationDeg","sunIntensity","skyIntensity","groundIntensity","exposure","horizonSoftness","sunDiskIntensity","sunGlowIntensity","hazeIntensity","postProcessOpacity","postProcessExposure","postProcessContrast","postProcessSaturation","postProcessVignette","bubbleRadius","digRadius","brushMaterial","brushHeight","brushStrength","brushFalloff","brushFlowMs","grassDistance","grassBladeSpacing","grassBladeHeight","grassBladeHeightVariation","grassBladeWidth","grassWindStrength","grassWindSpeed","grassSlopeMinY","grassMinHeight","grassMaxHeight","grassMaxBlades","grassSeed"],rE=["enforce21","freeze","wireframe","showBounds","showSeamPoints","showCrossLodBorders","colorByLod","normalColor","normalDivergence","frontSideOnly","recomputedNormals","triplanar","albedo","normalMap","postProcessEnabled","bubble","tintBubble","digEnabled","grassEnabled"];function Qn(n){return typeof n=="object"&&n!==null&&!Array.isArray(n)}function St(n){return typeof n=="number"&&Number.isFinite(n)}function Cf(n){return Array.isArray(n)&&n.length===3&&n.every(St)}function sE(n){if(!Qn(n)||!Qn(n.page)||!Qn(n.simplify)||!Qn(n.selection)||!Qn(n.near_field)||!Qn(n.simplify.attribute_weights))throw new Error("project.json has an invalid CLOD config snapshot");const e=[n.page.chunks_per_page,n.page.chunk_size,n.page.halo_chunks,n.page.quadtree_levels,n.simplify.target_ratio_per_level,n.simplify.abandon_ratio,n.simplify.target_error,n.simplify.weld_epsilon_cells,n.simplify.attribute_weights.normal,n.simplify.attribute_weights.material,n.selection.error_threshold_px,n.selection.hysteresis_merge_factor,n.selection.neighbor_level_delta_max,n.selection.crossfade_frames,n.near_field.radius_chunks],t=n.page.chunks_per_page,i=n.page.chunk_size,r=n.page.quadtree_levels;if(!e.every(St)||typeof n.meshopt_package_version!="string"||!["instant","dither"].includes(String(n.selection.transition_mode))||!St(t)||t<1||t>16||!St(i)||i<4||i>128||!St(r)||r<1||r>8)throw new Error("project.json has unsafe or invalid CLOD config values")}function oE(n){if(!Qn(n))throw new Error("project.json is missing session state");for(const l of iE)if(!St(n[l])||Math.abs(n[l])>1e6)throw new Error(`project.json state.${l} must be a safe finite number`);for(const l of rE)if(typeof n[l]!="boolean")throw new Error(`project.json state.${l} must be a boolean`);if(!["auto","0","1","2","3"].includes(String(n.forceMaxLevel)))throw new Error("project.json has an invalid forceMaxLevel");if(!["hard bands","blend bands"].includes(String(n.textureBlendMode)))throw new Error("project.json has an invalid textureBlendMode");if(!["output","copy","off"].includes(String(n.postProcessDebugMode)))throw new Error("project.json has an invalid postProcessDebugMode");if(!["remove","add"].includes(String(n.brushOp)))throw new Error("project.json has an invalid brushOp");if(!["sphere","cube","cylinder"].includes(String(n.brushShape)))throw new Error("project.json has an invalid brushShape");const e=n.brushMaterial,t=n.digRadius,i=n.brushHeight,r=n.brushStrength,s=n.brushFalloff,o=n.brushFlowMs,a=n.grassMaxBlades;if(!St(e)||!Number.isInteger(e)||e<0||e>=rn||!St(t)||t<1||t>8||!St(i)||i<1||i>16||!St(r)||r<0||r>1||!St(s)||s<0||s>1||!St(o)||o<80||o>600||!St(a)||a<0||a>1e5)throw new Error("project.json has unsafe brush or grass settings")}function aE(n,e){if(!Qn(n)||!St(n.x)||!St(n.y)||!St(n.z)||!St(n.r)||n.r<=0)throw new Error(`project.json terrainEdits[${e}] is invalid`);if(n.shape!==void 0&&!["sphere","cube","cylinder"].includes(String(n.shape)))throw new Error(`project.json terrainEdits[${e}] has an invalid shape`);if(n.op!==void 0&&!["remove","add"].includes(String(n.op)))throw new Error(`project.json terrainEdits[${e}] has an invalid operation`);if(n.material!==void 0&&(!St(n.material)||!Number.isInteger(n.material)||n.material<0||n.material>=rn))throw new Error(`project.json terrainEdits[${e}] has an invalid material`);if(n.height!==void 0&&(!St(n.height)||n.height<=0||n.height>16))throw new Error(`project.json terrainEdits[${e}] has an invalid height`);if(n.strength!==void 0&&(!St(n.strength)||n.strength<0||n.strength>1))throw new Error(`project.json terrainEdits[${e}] has an invalid strength`);if(n.falloff!==void 0&&(!St(n.falloff)||n.falloff<0||n.falloff>1))throw new Error(`project.json terrainEdits[${e}] has an invalid falloff`)}function lE(n,e){if(!Qn(n)||n.index!==e||!["empty","builtin","custom"].includes(String(n.source))||typeof n.name!="string"||typeof n.selectedId!="string"||!St(n.scale)||!St(n.heightMin)||!St(n.heightMax))throw new Error(`project.json textures[${e}] is invalid`);if(n.source==="custom"&&(typeof n.customPath!="string"||!new RegExp(`^textures/slot-${e}\\.[a-z0-9]{1,8}$`,"i").test(n.customPath)||typeof n.mimeType!="string"))throw new Error(`project.json textures[${e}] is missing custom texture metadata`);if(n.normalPath!==void 0&&(typeof n.normalPath!="string"||!new RegExp(`^textures/slot-${e}-normal\\.[a-z0-9]{1,8}$`,"i").test(n.normalPath)||typeof n.normalMimeType!="string"))throw new Error(`project.json textures[${e}] has invalid normal-map metadata`)}function Ju(n){if(!Qn(n)||n.schemaVersion!==im||n.kind!=="drusniel-clod-project")throw new Error("Unsupported CLOD project format or schema version");if(!St(n.worldSize)||![2,4,8,16,32].includes(n.worldSize))throw new Error("project.json has an unsupported world size");if(typeof n.exportedAt!="string"||Number.isNaN(Date.parse(n.exportedAt)))throw new Error("project.json has an invalid export timestamp");if(sE(n.config),oE(n.state),!Array.isArray(n.terrainEdits))throw new Error("project.json terrainEdits must be an array");if(n.terrainEdits.forEach(aE),!Array.isArray(n.textures)||n.textures.length<1||n.textures.length>rn)throw new Error(`project.json must contain between 1 and ${rn} texture slots`);if(n.textures.forEach((e,t)=>lE(e,t)),!Qn(n.camera)||!Cf(n.camera.position)||!Cf(n.camera.target))throw new Error("project.json has invalid orbit camera data");return n}async function cE(n,e,t){const{strToU8:i,zipSync:r}=await lo(async()=>{const{strToU8:o,zipSync:a}=await import("./browser-igZ1KgeZ.js");return{strToU8:o,zipSync:a}},[]);Ju(n);const s={[vu]:[i(JSON.stringify(n,null,2)),{level:6}],[yu]:[e,{level:0}]};for(const o of n.textures){if(o.source==="custom"&&o.customPath){const a=t.get(o.customPath);if(!a)throw new Error(`Missing custom texture bytes for ${o.customPath}`);s[o.customPath]=[a,{level:0}]}if(o.normalPath){const a=t.get(o.normalPath);if(!a)throw new Error(`Missing normal-map bytes for ${o.normalPath}`);s[o.normalPath]=[a,{level:0}]}}return r(s)}async function uE(n){const{strFromU8:e,unzipSync:t}=await lo(async()=>{const{strFromU8:l,unzipSync:c}=await import("./browser-igZ1KgeZ.js");return{strFromU8:l,unzipSync:c}},[]);let i;try{i=t(n)}catch{throw new Error("The selected file is not a readable ZIP archive")}if(!i[vu])throw new Error("The archive is missing project.json");if(!i[yu])throw new Error("The archive is missing terrain.glb");const r=i[yu];if(r.byteLength<12||new DataView(r.buffer,r.byteOffset,r.byteLength).getUint32(0,!0)!==1179937895)throw new Error("terrain.glb is not a valid binary glTF file");let s;try{s=JSON.parse(e(i[vu]))}catch{throw new Error("project.json is not valid JSON")}const o=Ju(s),a=new Map;for(const l of o.textures){if(l.source==="custom"&&l.customPath){const c=i[l.customPath];if(!c)throw new Error(`The archive is missing ${l.customPath}`);a.set(l.customPath,c)}if(l.normalPath){const c=i[l.normalPath];if(!c)throw new Error(`The archive is missing ${l.normalPath}`);a.set(l.normalPath,c)}}return{manifest:o,terrainGlb:r,customTextures:a}}function rm(n){return new Promise((e,t)=>{n.onsuccess=()=>e(n.result),n.onerror=()=>t(n.error??new Error("IndexedDB request failed"))})}function sm(n){return new Promise((e,t)=>{n.oncomplete=()=>e(),n.onerror=()=>t(n.error??new Error("IndexedDB transaction failed")),n.onabort=()=>t(n.error??new Error("IndexedDB transaction was aborted"))})}async function om(){const n=indexedDB.open(nE,1);return n.onupgradeneeded=()=>{n.result.objectStoreNames.contains(Es)||n.result.createObjectStore(Es)},rm(n)}async function dE(n){const e=crypto.randomUUID(),t={manifest:n.manifest,terrainGlb:n.terrainGlb,customTextures:[...n.customTextures]},i=await om();try{const r=i.transaction(Es,"readwrite");r.objectStore(Es).put(t,e),await sm(r)}finally{i.close()}return e}async function hE(n){const e=await om();try{const t=e.transaction(Es,"readwrite"),i=t.objectStore(Es),r=await rm(i.get(n));return r&&i.delete(n),await sm(t),r?{manifest:Ju(r.manifest),terrainGlb:r.terrainGlb,customTextures:new Map(r.customTextures)}:null}finally{e.close()}}const Pf={grass:{base:"#4fa647",light:"#b9ef8a",dark:"#23572b",glow:"#9fe070",accent:"#102d16"},earth:{base:"#9a6a3e",light:"#d8ab72",dark:"#50301d",glow:"#d89a50",accent:"#24140c"},rock:{base:"#89939a",light:"#d7e0e5",dark:"#3d474f",glow:"#cfe4ff",accent:"#1d252b"},sand:{base:"#d6b66c",light:"#fff0b4",dark:"#78602d",glow:"#ffe7a0",accent:"#3c3013"},snow:{base:"#dcebf2",light:"#ffffff",dark:"#7f9cac",glow:"#edfaff",accent:"#405461"},water:{base:"#4aa4d8",light:"#bceaff",dark:"#1f507e",glow:"#8fe0ff",accent:"#0d2a45"},steel:{base:"#aebdc8",light:"#eef4f8",dark:"#4e5a66",glow:"#cfe4ff",accent:"#2b333c"},gold:{base:"#e8b33a",light:"#ffe9a8",dark:"#8a5f12",glow:"#ffd97a",accent:"#5c3e08"},warning:{base:"#d74c35",light:"#ffb29b",dark:"#721b14",glow:"#ff704f",accent:"#330906"},debug:{base:"#56d0cf",light:"#c8ffff",dark:"#1e6b72",glow:"#8affff",accent:"#0b3034"},paint:{base:"#c66ee8",light:"#f0c8ff",dark:"#5e2a78",glow:"#e0a0ff",accent:"#2a0e38"},camera:{base:"#77a9ff",light:"#d8e9ff",dark:"#2b5ba0",glow:"#a0d4ff",accent:"#102b54"},paper:{base:"#e7d2a0",light:"#fff3c9",dark:"#8f6c35",glow:"#fff0b0",accent:"#463016"}},fE={terrain:["#b9ef8a","#347a35","#0d2412"],earth:["#d8a868","#74481e","#20120a"],rock:["#c8d4dc","#5a6878","#181d24"],sand:["#ffe6a0","#a88330","#30240a"],snow:["#ffffff","#7898ad","#162834"],water:["#a8e8ff","#2a6890","#0a2030"],texture:["#d6c1a0","#6a5842","#1d1813"],tool:["#c8d4dc","#5a6878","#181d24"],lod:["#a8c8e8","#3a5a80","#101c2c"],debug:["#94fff1","#247c84","#08292f"],camera:["#bddcff","#315d9a","#101d33"],project:["#f0e0b0","#907040","#2a200c"],system:["#c8d4dc","#4d5b63","#141a1e"],danger:["#ff9a74","#a02818","#2e0a06"],fallback:["#a8a8a0","#4e4e48","#141412"]},qi=Math.PI*2;function Mi(n,e,t,i,r,s){const o=n.createLinearGradient(e,t,i,r);for(const[a,l]of s)o.addColorStop(a,l);return o}function ps(n,e,t,i,r){const s=n.createRadialGradient(e,t,0,e,t,i);for(const[o,a]of r)s.addColorStop(o,a);return s}function Bn(n,e,t,i,r,s){n.beginPath(),n.moveTo(e+s,t),n.arcTo(e+i,t,e+i,t+r,s),n.arcTo(e+i,t+r,e,t+r,s),n.arcTo(e,t+r,e,t,s),n.arcTo(e,t,e+i,t,s),n.closePath()}function Yt(n,e,t){n.strokeStyle=e,n.lineWidth=t,n.stroke()}function ba(n){n.shadowColor="transparent",n.shadowBlur=0,n.shadowOffsetX=0,n.shadowOffsetY=0}function Rn(n,e){const t=Number.parseInt(n.slice(1),16);return`rgba(${t>>16&255},${t>>8&255},${t&255},${e})`}function pE(n){let e=2166136261;for(let t=0;t<n.length;t++)e^=n.charCodeAt(t),e=Math.imul(e,16777619);return e>>>0}function mE(n){let e=n>>>0;return()=>{e=e+1831565813|0;let t=Math.imul(e^e>>>15,1|e);return t=t+Math.imul(t^t>>>7,61|t)^t,((t^t>>>14)>>>0)/4294967296}}function gE(n,e){n.beginPath(),n.moveTo(0,-e),n.lineTo(e,0),n.lineTo(0,e),n.lineTo(-e,0),n.closePath()}function Sa(n,e,t){const i=e==="up"?1:-1;n.fillStyle=Mi(n,0,-28*i,0,28*i,[[0,t.light],[.55,t.base],[1,t.dark]]),Bn(n,-5,-5*i,10,30*i,3),n.fill(),Yt(n,t.accent,1.4),n.beginPath(),n.moveTo(0,-30*i),n.lineTo(17,-8*i),n.lineTo(6,-8*i),n.lineTo(6,2*i),n.lineTo(-6,2*i),n.lineTo(-6,-8*i),n.lineTo(-17,-8*i),n.closePath(),n.fill(),Yt(n,t.accent,1.5)}const _E={terrainTile(n,e){n.beginPath(),n.moveTo(-24,-8),n.lineTo(0,-22),n.lineTo(24,-8),n.lineTo(0,7),n.closePath(),n.fillStyle=Mi(n,-12,-21,18,0,[[0,e.light],[.6,e.base],[1,e.dark]]),n.fill(),Yt(n,e.accent,1.5),n.beginPath(),n.moveTo(-24,-8),n.lineTo(0,7),n.lineTo(0,28),n.lineTo(-24,12),n.closePath(),n.fillStyle=Rn(e.dark,.9),n.fill(),n.beginPath(),n.moveTo(24,-8),n.lineTo(0,7),n.lineTo(0,28),n.lineTo(24,12),n.closePath(),n.fillStyle=Rn(e.base,.8),n.fill(),Yt(n,e.accent,1.1)},grassTuft(n,e){n.fillStyle=e.light;for(const t of[-13,-6,1,8,15])n.beginPath(),n.moveTo(t,18),n.quadraticCurveTo(t-5,-4,t+(t%2?5:-5),-24),n.quadraticCurveTo(t+4,-2,t+4,18),n.closePath(),n.fill(),Yt(n,e.dark,.8)},stone(n,e){for(const[t,i,r]of[[-10,3,13],[5,-6,17],[13,11,10]])n.beginPath(),n.ellipse(t,i,r,r*.72,-.25,0,qi),n.fillStyle=ps(n,t-5,i-5,r*1.3,[[0,e.light],[.6,e.base],[1,e.dark]]),n.fill(),Yt(n,e.accent,1.2)},waves(n,e){n.strokeStyle=e.light,n.lineWidth=5,n.lineCap="round";for(const t of[-14,0,14])n.beginPath(),n.moveTo(-25,t),n.bezierCurveTo(-13,t-10,-7,t+10,5,t),n.bezierCurveTo(15,t-8,20,t+6,27,t),n.stroke()},page(n,e){n.beginPath(),n.moveTo(-18,-26),n.lineTo(9,-26),n.lineTo(20,-15),n.lineTo(20,26),n.lineTo(-18,26),n.closePath(),n.fillStyle=Mi(n,-18,-26,20,26,[[0,e.light],[.65,e.base],[1,e.dark]]),n.fill(),Yt(n,e.accent,1.5),ba(n),n.strokeStyle=Rn(e.accent,.65),n.lineWidth=2;for(const t of[-8,2,12])n.beginPath(),n.moveTo(-9,t),n.lineTo(11,t),n.stroke();n.beginPath(),n.moveTo(9,-26),n.lineTo(9,-15),n.lineTo(20,-15),n.stroke()},slot(n,e){n.fillStyle=Rn(e.dark,.5),Bn(n,-24,-24,48,48,8),n.fill(),Yt(n,Rn(e.light,.8),2.2),n.strokeStyle=Rn(e.light,.35),n.lineWidth=2,n.beginPath(),n.moveTo(-12,0),n.lineTo(12,0),n.moveTo(0,-12),n.lineTo(0,12),n.stroke()},shovel(n,e){n.rotate(.7),n.fillStyle=Mi(n,-3,-25,3,21,[[0,"#9b6a34"],[1,"#3a2110"]]),Bn(n,-3,-28,6,48,3),n.fill(),Yt(n,"#241307",1),n.beginPath(),n.moveTo(-12,16),n.quadraticCurveTo(0,34,12,16),n.lineTo(7,1),n.lineTo(-7,1),n.closePath(),n.fillStyle=Mi(n,-10,2,10,28,[[0,e.light],[.55,e.base],[1,e.dark]]),n.fill(),Yt(n,e.accent,1.4)},arrowUp(n,e){Sa(n,"up",e)},arrowDown(n,e){Sa(n,"down",e)},smooth(n,e){n.strokeStyle=e.light,n.lineWidth=5,n.lineCap="round",n.beginPath(),n.arc(0,0,23,-2.7,1.2),n.stroke(),n.beginPath(),n.arc(0,0,13,.3,3.8),n.stroke(),n.beginPath(),n.moveTo(9,-22),n.lineTo(20,-21),n.lineTo(14,-11),n.fillStyle=e.light,n.fill()},brush(n,e){n.rotate(-.55),n.fillStyle=Mi(n,-4,-26,4,15,[[0,"#d7b170"],[1,"#4a2a10"]]),Bn(n,-4,-26,8,42,3),n.fill(),Yt(n,"#241307",1),n.beginPath(),n.moveTo(-10,14),n.lineTo(10,14),n.lineTo(7,29),n.quadraticCurveTo(0,34,-7,29),n.closePath(),n.fillStyle=ps(n,-3,20,18,[[0,e.light],[.5,e.base],[1,e.dark]]),n.fill(),Yt(n,e.accent,1.3)},grid(n,e){n.fillStyle=Rn(e.dark,.35),Bn(n,-26,-26,52,52,6),n.fill(),n.strokeStyle=e.light,n.lineWidth=2.2;for(const t of[-13,0,13])n.beginPath(),n.moveTo(t,-25),n.lineTo(t,25),n.stroke();for(const t of[-13,0,13])n.beginPath(),n.moveTo(-25,t),n.lineTo(25,t),n.stroke()},lodBadge(n,e){gE(n,23),n.fillStyle=ps(n,-6,-8,28,[[0,e.light],[.55,e.base],[1,e.dark]]),n.fill(),Yt(n,e.accent,1.7),ba(n),n.strokeStyle=Rn(e.light,.8),n.lineWidth=2.4,n.beginPath(),n.moveTo(-10,2),n.lineTo(-2,10),n.lineTo(13,-10),n.stroke()},lock(n,e){n.strokeStyle=e.light,n.lineWidth=5,n.beginPath(),n.arc(0,-6,12,Math.PI,0),n.stroke(),n.fillStyle=Mi(n,0,-2,0,25,[[0,e.light],[.55,e.base],[1,e.dark]]),Bn(n,-17,-2,34,27,5),n.fill(),Yt(n,e.accent,1.4)},warning(n,e){n.beginPath(),n.moveTo(0,-28),n.lineTo(28,23),n.lineTo(-28,23),n.closePath(),n.fillStyle=Mi(n,0,-28,0,23,[[0,e.light],[.45,e.base],[1,e.dark]]),n.fill(),Yt(n,e.accent,1.8),ba(n),n.fillStyle=e.accent,Bn(n,-2.4,-11,4.8,20,2),n.fill(),n.beginPath(),n.arc(0,16,2.7,0,qi),n.fill()},wireframe(n,e){n.strokeStyle=e.light,n.lineWidth=2.2;for(const t of[13,25])n.beginPath(),n.rect(-t,-t,t*2,t*2),n.stroke();n.beginPath(),n.moveTo(-25,-25),n.lineTo(25,25),n.moveTo(25,-25),n.lineTo(-25,25),n.stroke()},boundary(n,e){n.strokeStyle=e.light,n.lineWidth=4,n.setLineDash([9,5]),n.strokeRect(-25,-25,50,50),n.setLineDash([])},points(n,e){n.fillStyle=e.light;for(const[t,i]of[[-18,-12],[-4,7],[12,-16],[19,14],[-15,20],[3,-25]])n.beginPath(),n.arc(t,i,4.2,0,qi),n.fill(),Yt(n,e.dark,.8)},normalFan(n,e){n.strokeStyle=e.light,n.lineWidth=3,n.lineCap="round";for(const t of[-1.2,-.4,.35,1.05])n.beginPath(),n.moveTo(0,20),n.lineTo(Math.cos(t)*26,Math.sin(t)*26),n.stroke();n.fillStyle=e.base,n.beginPath(),n.arc(0,20,7,0,qi),n.fill()},orbit(n,e){n.strokeStyle=e.light,n.lineWidth=3,n.beginPath(),n.ellipse(0,0,27,15,-.45,0,qi),n.stroke(),n.beginPath(),n.arc(16,-12,5,0,qi),n.fillStyle=e.glow,n.fill()},player(n,e){n.beginPath(),n.arc(0,-13,8,0,qi),n.fillStyle=ps(n,-3,-16,10,[[0,e.light],[1,e.base]]),n.fill(),Yt(n,e.accent,1.2),n.fillStyle=Mi(n,0,-4,0,25,[[0,e.base],[1,e.dark]]),Bn(n,-12,-3,24,31,8),n.fill(),Yt(n,e.accent,1.3)},importArrow(n,e){Sa(n,"down",e)},exportArrow(n,e){Sa(n,"up",e)},rebuild(n,e){n.strokeStyle=e.light,n.lineWidth=5,n.lineCap="round",n.beginPath(),n.arc(0,0,24,-2.5,.9),n.stroke(),n.beginPath(),n.arc(0,0,24,.65,3.95),n.stroke(),n.fillStyle=e.light,n.beginPath(),n.moveTo(19,1),n.lineTo(29,0),n.lineTo(23,10),n.fill(),n.beginPath(),n.moveTo(-19,-1),n.lineTo(-29,0),n.lineTo(-23,-10),n.fill()},sigil(n,e){n.strokeStyle=e.base,n.lineWidth=3,n.shadowColor=e.glow,n.shadowBlur=6,n.beginPath(),n.arc(0,0,21,0,qi),n.stroke(),n.strokeStyle=e.glow,n.lineWidth=3.5,n.lineJoin="round",n.beginPath(),n.moveTo(-9,12),n.lineTo(-9,-12),n.lineTo(0,2),n.lineTo(9,-12),n.lineTo(9,12),n.stroke(),ba(n)}},Rf={glow(n,e){n.fillStyle=ps(n,0,0,32,[[0,Rn(e.glow,.55)],[1,Rn(e.glow,0)]]),n.fillRect(-50,-50,100,100)},sparkle(n,e){n.globalCompositeOperation="lighter",n.fillStyle=e.light;for(const[t,i,r]of[[-18,-15,5.5],[16,-20,4.5],[20,13,3.5]])n.beginPath(),n.moveTo(t,i-r),n.lineTo(t+r*.38,i-r*.38),n.lineTo(t+r,i),n.lineTo(t+r*.38,i+r*.38),n.lineTo(t,i+r),n.lineTo(t-r*.38,i+r*.38),n.lineTo(t-r,i),n.lineTo(t-r*.38,i-r*.38),n.closePath(),n.fill();n.globalCompositeOperation="source-over"},crack(n,e){n.strokeStyle=Rn(e.dark,.9),n.lineWidth=2,n.lineCap="round",n.lineJoin="round",n.beginPath(),n.moveTo(-1,1),n.lineTo(-8,9),n.lineTo(-5,17),n.lineTo(-13,26),n.moveTo(3,-2),n.lineTo(10,-10),n.lineTo(7,-18),n.lineTo(15,-27),n.stroke()},motion(n,e){n.strokeStyle=Rn(e.light,.42),n.lineWidth=2.6,n.lineCap="round",n.beginPath();for(const t of[-12,0,12])n.moveTo(-27+t*.7,-25-t*.7),n.lineTo(22+t*.7,22-t*.7);n.stroke()}},vE=40;function yE(n,e,t){if(typeof document>"u")return null;const i=document.createElement("canvas");i.width=t,i.height=t;const r=i.getContext("2d");if(!r)return null;r.scale(t/100,t/100),r.save(),Bn(r,.5,.5,99,99,12),r.clip();const s=fE[n.bg];r.fillStyle=ps(r,35,30,85,[[0,s[0]],[.55,s[1]],[1,s[2]]]),r.fillRect(0,0,100,100);const o=r.createRadialGradient(50,50,55,50,50,85);o.addColorStop(0,"rgba(0,0,0,0)"),o.addColorStop(1,"rgba(0,0,0,0.45)"),r.fillStyle=o,r.fillRect(0,0,100,100);const a=mE(pE(e));for(let d=0;d<vE;d++)r.fillStyle=d%2?"rgba(255,255,255,0.04)":"rgba(0,0,0,0.06)",r.fillRect(2+a()*96,2+a()*96,1.4,1.4);r.translate(50,50);const l=Pf[n.pal],c=n.fx??[];c.includes("glow")&&Rf.glow(r,l);for(const d of n.prims)r.save(),r.translate(d.x??0,d.y??0),d.rot&&r.rotate(d.rot),d.s&&r.scale(d.s,d.s),d.alpha&&(r.globalAlpha=d.alpha),r.shadowColor="rgba(0,0,0,0.6)",r.shadowBlur=3,r.shadowOffsetX=1,r.shadowOffsetY=2,_E[d.p](r,Pf[d.pal??n.pal]),r.restore();for(const d of c)d!=="glow"&&Rf[d](r,l);r.restore(),r.lineWidth=2,r.strokeStyle="#000000",Bn(r,1,1,98,98,11),r.stroke();const u=r.createLinearGradient(0,0,100,100);return u.addColorStop(0,"rgba(255,255,255,0.28)"),u.addColorStop(.5,"rgba(255,255,255,0.05)"),u.addColorStop(.55,"rgba(0,0,0,0.1)"),u.addColorStop(1,"rgba(0,0,0,0.55)"),r.lineWidth=1.5,r.strokeStyle=u,Bn(r,2.4,2.4,95.2,95.2,10),r.stroke(),r.lineWidth=1,r.strokeStyle=Rn(s[0],.22),Bn(r,3.6,3.6,92.8,92.8,9),r.stroke(),i}function xE(n){const e=new TextEncoder().encode(`clod-icon:${n}`);let t="";for(const i of e)t+=String.fromCharCode(i);return`data:image/png;base64,${globalThis.btoa(t)}`}const bE={x:13,y:-13,s:.45},to={x:13,y:13,s:.45},SE={s:1.15,alpha:.35};function dt(n,e,t,i){return{bg:n,pal:e,prims:t.map(r=>typeof r=="string"?{p:r}:r),fx:i}}const ME=dt("fallback","steel",["sigil"]),wE={terrain:{grass:dt("terrain","grass",["terrainTile","grassTuft"],["glow"]),earth:dt("earth","earth",["terrainTile"]),rock:dt("rock","rock",["terrainTile",{p:"stone",...to,pal:"rock"}],["crack"]),sand:dt("sand","sand",["terrainTile"]),snow:dt("snow","snow",["terrainTile",{p:"sigil",...bE,pal:"snow"}],["sparkle"]),water:dt("water","water",["waves"],["glow"])},texture:{load:dt("texture","paper",["page",{p:"importArrow",...to,pal:"gold"}],["sparkle"]),slot:dt("texture","steel",["slot"])},tool:{dig:dt("tool","steel",["shovel"],["motion"]),raise:dt("tool","gold",["arrowUp"]),lower:dt("tool","steel",["arrowDown"]),smooth:dt("tool","water",["smooth"],["glow"]),paint:dt("tool","paint",["brush"],["sparkle"])},lod:{page:dt("lod","paper",[{p:"grid",...SE,pal:"camera"},"page"]),lod0:dt("lod","gold",["lodBadge"],["glow"]),lod1:dt("lod","steel",["lodBadge"]),lod2:dt("lod","water",["lodBadge"]),lod3:dt("lod","rock",["lodBadge"]),"locked-border":dt("lod","gold",["grid",{p:"lock",...to,pal:"gold"}]),error:dt("danger","warning",["warning"],["glow","crack"])},debug:{wireframe:dt("debug","debug",["wireframe"],["glow"]),"page-boundary":dt("debug","debug",["boundary"]),"seam-points":dt("debug","debug",["points"],["sparkle"]),"normal-colors":dt("debug","paint",["normalFan"],["glow"])},camera:{orbit:dt("camera","camera",["orbit"],["motion"]),player:dt("camera","camera",["player"],["glow"])},project:{import:dt("project","paper",["page",{p:"importArrow",...to,pal:"gold"}]),export:dt("project","paper",["page",{p:"exportArrow",...to,pal:"gold"}])},system:{rebuild:dt("system","steel",["rebuild"],["motion"]),warning:dt("danger","warning",["warning"],["glow"])}},EE=96,Lf=new Map,If=new Set;function TE(){return!1}function AE(n,e){const t=wE[n]?.[e];if(t)return t;const i=`${n}/${e}`;return TE()&&!If.has(i)&&(If.add(i),console.warn(`[icons] no recipe for ${i}; using fallback icon`)),ME}function xu(n,e,t=EE){const i=`${n}|${e}|${t}`,r=Lf.get(i);if(r)return r;const o=yE(AE(n,e),i,t)?.toDataURL("image/png")??xE(i);return Lf.set(i,o),o}const Df="clod-icon-label",am="clod-icon-button",lm="clod-icon-only",Nf="clod-button-text",Uf="clod-visually-hidden";function Qu(n,e){return Array.from(n.children).find(t=>t.classList.contains(e))??null}function cm(n,e,t){let i=Qu(n,Df);return i||(i=document.createElement("span"),i.className=Df,i.setAttribute("aria-hidden","true"),n.insertBefore(i,n.firstChild)),i.style.backgroundImage=`url("${xu(e,t)}")`,i}function CE(n){for(const e of Array.from(n.childNodes))e.nodeType===Node.TEXT_NODE&&e.textContent?.trim()&&e.remove()}function um(n,e){n.setAttribute("aria-label",e),n.getAttribute("title")||n.setAttribute("title",e)}function os(n,e,t,i){n.classList.add(am),n.classList.remove(lm),um(n,i),cm(n,e,t),CE(n);let r=Qu(n,Nf);r||(r=document.createElement("span"),r.className=Nf,n.appendChild(r)),r.textContent=i}function Ff(n,e,t,i){n.classList.add(am,lm),um(n,i),cm(n,e,t);let r=Qu(n,Uf);r||(r=document.createElement("span"),r.className=Uf,n.appendChild(r)),r.textContent=i}function no(n){const e=document.createElement("div");e.className="clod-meter-row",e.innerHTML=`
    <div class="clod-meter-top">
      <span class="clod-meter-label"></span>
      <span class="clod-meter-value"></span>
    </div>
    <div class="clod-meter-track"><span class="clod-meter-fill"></span></div>
  `;const t=e.querySelector(".clod-meter-label"),i=e.querySelector(".clod-meter-value"),r=e.querySelector(".clod-meter-fill"),s=e.querySelector(".clod-meter-track"),o=a=>{t.textContent=a.label,i.textContent=a.value,e.dataset.severity=a.severity??"neutral",a.fraction==null?(s.hidden=!0,r.style.width="0%"):(s.hidden=!1,r.style.width=`${Math.max(0,Math.min(1,a.fraction))*100}%`)};return o(n),{element:e,update:o}}let dm=null;const cc=n=>Math.round(n).toLocaleString();function PE(n){const e=Object.entries(n).map(([t,i])=>[Number(t),i]).sort(([t],[i])=>t-i).map(([t,i])=>`L${t}:${i}`);return e.length>0?e.join("  "):"none"}function Of(n,e,t){n.querySelector(e).textContent=t}function RE(n){n.innerHTML=`
    <section class="clod-overlay-panel" aria-live="polite">
      <header>
        <span class="clod-overlay-kicker">CLOD Runtime</span>
        <strong class="clod-overlay-world">world --</strong>
      </header>
      <div class="clod-overlay-meters"></div>
      <div class="clod-overlay-flags">
        <span data-overlay-freeze>live cut</span>
        <span data-overlay-status>preparing</span>
      </div>
      <p class="clod-overlay-dig"></p>
      <p class="clod-overlay-polish"></p>
    </section>
  `;const e=n.querySelector(".clod-overlay-meters"),t=[no({label:"Triangles",value:"0",fraction:0,severity:"neutral"}),no({label:"LOD cut",value:"none",severity:"neutral"}),no({label:"2:1 splits",value:"0",fraction:0,severity:"ok"}),no({label:"Bubble splits",value:"0",fraction:0,severity:"ok"}),no({label:"Error threshold",value:"0.00 px",fraction:0,severity:"neutral"})];for(const r of t)e.appendChild(r.element);const i={update(r){Of(n,".clod-overlay-world",`${r.worldSize}x${r.worldSize} pages`),t[0].update({label:"Triangles",value:cc(r.renderedTriangles),fraction:Math.min(1,r.renderedTriangles/25e4),severity:r.renderedTriangles>2e5?"warn":"ok"}),t[1].update({label:"LOD cut",value:PE(r.nodesByLod),severity:"neutral"}),t[2].update({label:"2:1 splits",value:cc(r.forcedSplits),fraction:Math.min(1,r.forcedSplits/64),severity:r.forcedSplits>64?"warn":"ok"}),t[3].update({label:"Bubble splits",value:cc(r.bubbleForcedSplits),fraction:Math.min(1,r.bubbleForcedSplits/64),severity:r.bubbleForcedSplits>64?"warn":"ok"}),t[4].update({label:"Error threshold",value:`${r.errorThreshold.toFixed(2)} px`,fraction:Math.min(1,r.errorThreshold/6),severity:r.errorThreshold<.8?"warn":"neutral"});const s=n.querySelector("[data-overlay-freeze]");s.textContent=r.cutFrozen?"cut frozen":"live cut",s.dataset.severity=r.cutFrozen?"warn":"ok",Of(n,"[data-overlay-status]",r.buildStatus??"ready");const o=n.querySelector(".clod-overlay-dig");o.hidden=!r.digCostLine,o.textContent=r.digCostLine?`Last edit: ${r.digCostLine}`:"";const a=n.querySelector(".clod-overlay-polish");a.hidden=!r.polishLine,a.textContent=r.polishLine??""}};return dm=i,i}function uc(n){dm?.update(n)}function LE(){return{candidateQuads:0,flipped:0,rejectedDegenerate:0,rejectedWinding:0,rejectedLockedBorder:0,rejectedNoImprovement:0,averageScoreImprovement:0}}function IE(n){const e=LE();let t=0;for(const i of n)e.candidateQuads+=i.candidateQuads,e.flipped+=i.flipped,e.rejectedDegenerate+=i.rejectedDegenerate,e.rejectedWinding+=i.rejectedWinding,e.rejectedLockedBorder+=i.rejectedLockedBorder,e.rejectedNoImprovement+=i.rejectedNoImprovement,t+=i.averageScoreImprovement*i.flipped;return e.averageScoreImprovement=e.flipped>0?t/e.flipped:0,e}function DE(n){return`diag polish: candidates=${n.candidateQuads.toLocaleString()} flips=${n.flipped.toLocaleString()} rejected=${(n.rejectedDegenerate+n.rejectedWinding+n.rejectedLockedBorder+n.rejectedNoImprovement).toLocaleString()} avg_gain=${n.averageScoreImprovement.toFixed(4)}`}function NE(n){return nm(n)}class UE{constructor(e){this.scene=e}material=new Nu({color:16767338,size:5,sizeAttenuation:!1,depthTest:!1,depthWrite:!1});points=null;setVisible(e){this.points&&(this.points.visible=e)}rebuild(e,t){this.disposePoints();const i=[];for(const s of e){const o=NE(s.mesh),a=s.mesh.positions;for(let l=0;l<o.length;l++)o[l]&&i.push(a[l*3],a[l*3+1]+.18,a[l*3+2])}if(i.length===0)return;const r=new Ct;r.setAttribute("position",new pt(new Float32Array(i),3)),this.points=new Mp(r,this.material),this.points.visible=t,this.points.renderOrder=24,this.scene.add(this.points)}dispose(){this.disposePoints(),this.material.dispose()}disposePoints(){this.points&&(this.scene.remove(this.points),this.points.geometry.dispose(),this.points=null)}}const FE=64;class OE{constructor(e){this.root=e,e.classList.add("clod-node-label-layer")}labels=[];scratch=new z;cameraSpace=new z;setVisible(e){this.root.hidden=!e}update({nodes:e,camera:t,viewport:i,viewportHeight:r,fovY:s}){if(this.root.hidden)return;const o=i.clientWidth,a=i.clientHeight,l=new z().setFromMatrixPosition(t.matrixWorld),c=e.slice(0,FE);this.ensureLabelCount(c.length);for(let u=0;u<this.labels.length;u++){const d=this.labels[u],h=c[u];if(!h){d.element.hidden=!0;continue}this.scratch.fromArray(h.bounds.center),this.cameraSpace.copy(this.scratch).applyMatrix4(t.matrixWorldInverse);const f=Math.max(.001,this.scratch.distanceTo(l)-h.bounds.radius),_=h.errorWorld*r/(2*f*Math.tan(s/2));this.scratch.project(t);const v=this.cameraSpace.z<0&&this.scratch.z>=-1&&this.scratch.z<=1&&this.scratch.x>=-1&&this.scratch.x<=1&&this.scratch.y>=-1&&this.scratch.y<=1;if(d.element.hidden=!v,!v)continue;d.nodeId!==h.id&&(d.nodeId=h.id,d.element.dataset.level=String(h.level));const g=(this.scratch.x*.5+.5)*o,m=(-this.scratch.y*.5+.5)*a;d.element.style.transform=`translate(${g.toFixed(1)}px, ${m.toFixed(1)}px)`,d.element.innerHTML=`
        <strong>${h.id}</strong>
        <span>L${h.level} · ${BE(h)}</span>
        <span>err ${h.errorWorld.toFixed(3)}w · ${_.toFixed(2)}px</span>
      `}}ensureLabelCount(e){for(;this.labels.length<e;){const t=document.createElement("div");t.className="clod-node-label",this.root.appendChild(t),this.labels.push({element:t,nodeId:""})}for(let t=e;t<this.labels.length;t++)this.labels[t].element.hidden=!0}}function BE(n){const{minX:e,minZ:t,maxX:i,maxZ:r}=n.footprint;return`${e},${t}-${i},${r}`}const ed=8,dc=4;function us(n,e,t=ed){const i=n>t,r=i?Math.max(0,Math.ceil(n/t)-1):0,s=Math.max(0,Math.min(e,r)),o=s*t,a=Math.min(n,o+t);return{page:s,maxPage:r,start:o,end:a,needsCarousel:i}}function kE(n,e=ed){return Math.floor(n/e)}function zE(n,e,t,i=ed){const r=kE(n,i),{start:s,end:o,page:a}=us(t,e,i);return n>=s&&n<o?a:r}const io=[10265517,3829413,4825208,14254130],Bf=[2,4,8,16,32],kf=[{id:"grass-2",scale:.06,heightMin:12,heightMax:18},{id:"earth-2",scale:.04,heightMin:18,heightMax:40},{id:"earth-1",scale:.04,heightMin:40,heightMax:60},{id:"snow-rocks-1",scale:.025,heightMin:60,heightMax:118}],HE=Object.assign({"../textures/bedrock-1.jpg":Gm,"../textures/bedrock-2.jpg":Wm,"../textures/cobblestone-1.jpg":$m,"../textures/cobblestone-2.jpg":Xm,"../textures/earth-1.jpg":jm,"../textures/earth-2.jpg":qm,"../textures/grass-1.jpg":Ym,"../textures/grass-2.jpg":Zm,"../textures/oak-bark-1.jpg":Km,"../textures/oak-bark-2.jpg":Jm,"../textures/oak-leaf-1.jpg":Qm,"../textures/oak-leaf-2.jpg":eg,"../textures/sand-1.jpg":tg,"../textures/sand-2.jpg":ng,"../textures/snow-1.jpg":ig,"../textures/snow-rocks-1.jpg":rg,"../textures/terracotta-1.jpg":sg,"../textures/terracotta-2.jpg":og,"../textures/water-1.jpg":ag,"../textures/water-2.jpg":lg}),Dt=n=>{const e=Object.entries(HE).find(([t])=>t.endsWith(`/${n}`));if(!e)throw new Error(`Bundled texture not found: ${n}`);return e[1]},as=[{id:"earth-1",label:"Earth 1",url:Dt("earth-1.jpg")},{id:"earth-2",label:"Earth 2",url:Dt("earth-2.jpg")},{id:"grass-1",label:"Grass 1",url:Dt("grass-1.jpg")},{id:"grass-2",label:"Grass 2",url:Dt("grass-2.jpg")},{id:"cobblestone-1",label:"Cobblestone 1",url:Dt("cobblestone-1.jpg")},{id:"cobblestone-2",label:"Cobblestone 2",url:Dt("cobblestone-2.jpg")},{id:"bedrock-1",label:"Bedrock 1",url:Dt("bedrock-1.jpg")},{id:"bedrock-2",label:"Bedrock 2",url:Dt("bedrock-2.jpg")},{id:"sand-1",label:"Sand 1",url:Dt("sand-1.jpg")},{id:"sand-2",label:"Sand 2",url:Dt("sand-2.jpg")},{id:"terracotta-1",label:"Terracotta 1",url:Dt("terracotta-1.jpg")},{id:"terracotta-2",label:"Terracotta 2",url:Dt("terracotta-2.jpg")},{id:"water-1",label:"Water 1",url:Dt("water-1.jpg")},{id:"water-2",label:"Water 2",url:Dt("water-2.jpg")},{id:"oak-bark-1",label:"Oak bark 1",url:Dt("oak-bark-1.jpg")},{id:"oak-bark-2",label:"Oak bark 2",url:Dt("oak-bark-2.jpg")},{id:"oak-leaf-1",label:"Oak leaf 1",url:Dt("oak-leaf-1.jpg")},{id:"oak-leaf-2",label:"Oak leaf 2",url:Dt("oak-leaf-2.jpg")},{id:"snow-1",label:"Snow 1",url:Dt("snow-1.jpg")},{id:"snow-rocks-1",label:"Snow rocks 1",url:Dt("snow-rocks-1.jpg")}],zf=["hard bands","blend bands"],Hf=["grass","earth","rock","snow"],Vf=new WeakMap;function VE(n){const e=Vf.get(n);if(e)return e;const t=n.positions.length/3,i=new Float32Array(t*ai),r=new Float32Array(t*ai);for(let o=0;o<t;o++){const a=JS(n.positions[o*3],n.positions[o*3+1],n.positions[o*3+2]);for(let l=0;l<ai;l++)i[o*ai+l]=a.slots[l],r[o*ai+l]=a.weights[l]}const s={slots:i,weights:r};return Vf.set(n,s),s}function hc(n){const e=new Ct;e.setAttribute("position",new pt(n.positions,3)),e.setAttribute("normal",new pt(n.normals,3));const{slots:t,weights:i}=VE(n);return e.setAttribute("paintSlots",new pt(t,ai)),e.setAttribute("paintWeights",new pt(i,ai)),e.setIndex(new pt(n.indices,1)),e}function GE(n){const e=new Ct;e.setAttribute("position",new pt(n.positions,3)),e.setIndex(new pt(n.indices,1)),e.computeVertexNormals();const t=e.getAttribute("normal").array.slice();return e.dispose(),t}function fc(n){return n.recomputedNormals||(n.recomputedNormals=GE(n.node.mesh)),n.recomputedNormals}function hm(n,e){const t=n.footprint,i=e.footprint,r=t.minZ<i.maxZ&&i.minZ<t.maxZ,s=t.minX<i.maxX&&i.minX<t.maxX;if(r){if(t.maxX===i.minX)return{axis:"x",aPlane:t.maxX,bPlane:i.minX};if(i.maxX===t.minX)return{axis:"x",aPlane:t.minX,bPlane:i.maxX}}if(s){if(t.maxZ===i.minZ)return{axis:"z",aPlane:t.maxZ,bPlane:i.minZ};if(i.maxZ===t.minZ)return{axis:"z",aPlane:t.minZ,bPlane:i.maxZ}}return null}function WE(n){const e=[];for(let t=0;t<n.length;t++)for(let i=t+1;i<n.length;i++){const r=n[t],s=n[i];if(r.level===s.level)continue;const o=hm(r,s);o&&e.push({a:r,b:s,edge:o})}return e}function Ma(n,e,t,i,r,s){const o=t==="x"?2:0,a=_u(e.mesh,t,i,e.footprint).positions.filter(l=>l[o]>=r-.001&&l[o]<=s+.001);for(let l=1;l<a.length;l++){const c=a[l-1],u=a[l];n.push(c[0],c[1]+.12,c[2],u[0],u[1]+.12,u[2])}}function $E(n,e){const{a:t,b:i,edge:r}=e;if(r.axis==="x"){const s=Math.max(t.footprint.minZ,i.footprint.minZ),o=Math.min(t.footprint.maxZ,i.footprint.maxZ);Ma(n,t,r.axis,r.aPlane,s,o),Ma(n,i,r.axis,r.bPlane,s,o)}else{const s=Math.max(t.footprint.minX,i.footprint.minX),o=Math.min(t.footprint.maxX,i.footprint.maxX);Ma(n,t,r.axis,r.aPlane,s,o),Ma(n,i,r.axis,r.bPlane,s,o)}}async function XE(){const n=document.getElementById("info");try{const I=new URLSearchParams(location.search).get("strict-content")==="true",V=cM({strict:I}),se=dM(V,{strict:I});if(console.log("[ContentRegistry] Load and Validation Summary:"),console.log(`- Materials: ${V.materials.size}`),console.log(`- Texture Slots: ${V.textureSlots.size}`),console.log(`- Biomes: ${V.biomes.size}`),console.log(`- Debug Presets: ${V.clodDebugPresets.size}`),console.log(`- Snap Pieces: ${V.snapPieces.size}`),se.ok)console.log("[ContentRegistry] Validation Status: OK");else{console.error(`[ContentRegistry] Validation Status: FAILED (${se.errors.length} errors, ${se.warnings.length} warnings)`);for(const le of se.errors)console.error(`  [ERROR] [${le.code}] at ${le.path}: ${le.message}`);if(I)throw new Error(`Content validation failed in strict mode: ${se.errors[0].message}`);n.textContent="Content Registry validation errors present (see dev console)"}if(se.warnings.length>0){console.warn(`[ContentRegistry] Validation Warnings (${se.warnings.length}):`);for(const le of se.warnings)console.warn(`  [WARNING] [${le.code}] at ${le.path}: ${le.message}`)}}catch(x){if(console.error("[ContentRegistry] Failed to initialize content registry:",x),n.textContent=`Content Registry load failed: ${x instanceof Error?x.message:String(x)}`,new URLSearchParams(location.search).get("strict-content")==="true")throw x}const e=document.getElementById("info-panel"),t=document.getElementById("info-close"),i=document.getElementById("info-reopen"),r=x=>{e.hidden=!x,i.hidden=x};t.addEventListener("click",()=>r(!1)),i.addEventListener("click",()=>r(!0)),RE(document.getElementById("clod-overlay"));const s=document.getElementById("project-import"),o=document.getElementById("project-export"),a=document.getElementById("project-import-input"),l=document.getElementById("orbit-mode"),c=document.getElementById("player-mode"),u=document.getElementById("player-mode-status"),d=document.getElementById("build-progress"),h=document.getElementById("build-progress-bar"),f=document.getElementById("build-progress-phase"),_=document.getElementById("build-progress-percent");Ff(s,"project","import","Import project"),Ff(o,"project","export","Export project"),os(l,"camera","orbit","Orbit"),os(c,"camera","player","Player");const v=new URLSearchParams(location.search),g=v.get("clodPerf")==="1",m=v.get("import");let y=null;if(m){d.hidden=!1,f.textContent="loading imported project",_.textContent="0%",h.value=0;try{if(y=await hE(m),!y)throw new Error("The staged project was not found or was already used");tt("project.import.success")}catch(x){tt("project.import.error"),n.textContent=`Project import failed: ${x instanceof Error?x.message:String(x)}`}finally{v.delete("import");const x=v.toString();history.replaceState(null,"",`${location.pathname}${x?`?${x}`:""}${location.hash}`)}}const S=y?.manifest.config??TS(AS),M=new RS;M.onError=x=>{tt("clod.rebuild.error"),console.error("[clod worker]",x)};const R=Number(v.get("world")),A=y?.manifest.worldSize??(Bf.includes(R)?R:4);let C="preparing";const D=()=>uc({worldSize:A,renderedTriangles:0,nodesByLod:{},forcedSplits:0,bubbleForcedSplits:0,cutFrozen:!1,errorThreshold:S.selection.error_threshold_px,buildStatus:C});D(),y&&jS(y.manifest.terrainEdits);const $=A>=16?" (worker build; large world may take a while)":A>=8?" (worker build)":"";n.textContent=`building ${A}x${A} world…${$}`,d.hidden=!1,f.textContent=`${y?"import: ":""}building ${A}x${A}`,_.textContent="0%",h.value=0,C=`${y?"import: ":""}building ${A}x${A}`,D(),await new Promise(x=>setTimeout(x,16));const b=await M.buildWorld(A,A,S,Gh(),({done:x,total:I,level:V,phase:se})=>{const le=I>0?Math.min(1,x/I):0;h.value=le,_.textContent=`${Math.floor(le*100)}%`,f.textContent=`${se}  L${V}  ${x}/${I}`,n.textContent=`building ${A}x${A} world… ${Math.floor(le*100)}%
${se}  L${V}  ${x}/${I}`,C=`${se} L${V} ${x}/${I}`,D()});d.hidden=!0,C="ready";const E=DE(IE(b.stats.map(x=>x.polish))),F=[...b.nodesByLevel.values()].flat(),O=new wb({antialias:!0});O.setSize(window.innerWidth,window.innerHeight),O.setPixelRatio(devicePixelRatio),O.outputColorSpace=Ln,O.toneMapping=$f,document.body.appendChild(O.domElement);const X=new bp,re=A*S.page.chunks_per_page*S.page.chunk_size,K=re/2,he=new kn(55,window.innerWidth/window.innerHeight,.5,8e3);he.position.set(K,re*.7,K+re*1.1);const j=new Wb(he,O.domElement);j.target.set(K,24,K),y&&(he.position.fromArray(y.manifest.camera.position),j.target.fromArray(y.manifest.camera.target),he.lookAt(j.target),j.update());const Ee=F.filter(x=>x.level===0).map(x=>({id:x.id,mesh:x.mesh,footprint:x.footprint})),_e=new $w(Ee),Se=new FM(_e,{minX:0,minZ:0,maxX:re,maxZ:re}),Me=new DM,ze={forward:0,right:0,sprint:!1,jump:!1},ue=new zb,me=new Xe,we=new z,ye=new z,Ve=new Rb;let Ne=0,qe=0,Be=!1,Ge=!1;const G=400;let vt=!1,et=-1/0;const Ze=new z,We=new Ri,at=new Xe;let He=!1;const U=()=>{ze.forward=0,ze.right=0,ze.sprint=!1,ze.jump=!1,vt=!1},P=()=>{document.body.dataset.playerMode=Me.mode,l.setAttribute("aria-pressed",String(Me.mode==="orbit")),c.setAttribute("aria-pressed",String(Me.mode!=="orbit")),Ge&&Me.mode==="playing"?u.textContent="Tab held — click palette · release Tab to look":u.textContent=Me.mode==="choosingSpawn"?"Click the terrain to choose your starting position":Me.mode==="playing"?`WASD · Shift · Space · Esc${ge()?" · click digs":""} · Shift+wheel radius`:"Orbit camera",document.body.dataset.tabUi=Ge?"true":"false",ne()},ne=()=>{fe&&(document.body.dataset.tfEdit=fe.checked?"true":"false")};let fe=null;const ge=()=>fe?.checked??!1,de=()=>{tt("camera.mode.orbit"),Ge=!1,document.pointerLockElement===O.domElement&&document.exitPointerLock(),Be=!1,Me.mode==="playing"&&(ye.copy(Se.position).addScaledVector(Jt.DEFAULT_UP,za.eyeHeight*.65),j.target.copy(ye),he.position.copy(ye).add(new z(8,6,8)),he.lookAt(ye)),Me.exitToOrbit(),U(),j.enabled=!0,j.update(),fe&&(fe.checked=!0,document.body.dataset.tfEdit="true"),P()},Fe=()=>{Me.chooseSpawn(),U(),j.enabled=!1,P()},be=x=>{const I=O.domElement.getBoundingClientRect();me.set((x.clientX-I.left)/I.width*2-1,-((x.clientY-I.top)/I.height)*2+1),ue.setFromCamera(me,he);const V=_e.raycastSpawn(ue.ray);if(!V){u.textContent="No playable terrain there";return}he.getWorldDirection(we),we.y=0,we.lengthSq()<1e-8?we.set(0,0,-1):we.normalize(),Ne=Math.atan2(-we.x,-we.z),qe=0,Se.spawn(V.point),Me.startPlaying(),tt("camera.mode.player"),j.enabled=!1,Fi.checked=!1,document.body.dataset.tfEdit="false",P(),O.domElement.requestPointerLock()};l.addEventListener("click",de),c.addEventListener("click",Fe);let Ae=null;O.domElement.addEventListener("pointerdown",x=>{Me.mode==="choosingSpawn"&&x.button===0?be(x):Me.mode==="playing"&&x.button===0&&document.pointerLockElement!==O.domElement?O.domElement.requestPointerLock():Me.mode==="playing"&&x.button===0&&T.digEnabled&&ge()?(vt=!0,he.getWorldDirection(Ze),Qa(new Ri(he.position.clone(),Ze.clone()))):Me.mode==="orbit"&&x.button===0&&T.digEnabled&&(Ae={x:x.clientX,y:x.clientY})}),O.domElement.addEventListener("pointerup",x=>{if((x.button===0&&vt||x.button===0)&&(vt=!1),!Ae||x.button!==0)return;const I=Math.hypot(x.clientX-Ae.x,x.clientY-Ae.y);if(Ae=null,I>4||Me.mode!=="orbit"||!T.digEnabled)return;const V=O.domElement.getBoundingClientRect();me.set((x.clientX-V.left)/V.width*2-1,-((x.clientY-V.top)/V.height)*2+1),ue.setFromCamera(me,he),Qa(ue.ray)}),O.domElement.addEventListener("pointermove",x=>{const I=O.domElement.getBoundingClientRect();at.set((x.clientX-I.left)/I.width*2-1,-((x.clientY-I.top)/I.height)*2+1),He=!0}),O.domElement.addEventListener("pointerleave",()=>{He=!1}),document.addEventListener("pointerlockchange",()=>{if(document.pointerLockElement===O.domElement)Be=!0,Ge=!1,P();else if(Me.mode==="playing"&&Be){if(Be=!1,Ge){P();return}de()}}),document.addEventListener("pointerlockerror",()=>{Me.mode==="playing"&&(u.textContent="Click viewport to capture mouse")}),document.addEventListener("mousemove",x=>{Me.mode!=="playing"||document.pointerLockElement!==O.domElement||(Ne-=x.movementX*.002,qe=Nt.clamp(qe-x.movementY*.002,-1.5,1.5))}),window.addEventListener("keydown",x=>{if(x.code==="Escape"&&Me.mode==="choosingSpawn"){de();return}if(x.code==="Escape"&&Me.mode==="playing"&&!Be){de();return}if(x.code==="Tab"&&Me.mode==="playing"){x.preventDefault(),document.pointerLockElement===O.domElement&&(Ge=!0,document.exitPointerLock());return}Me.mode==="playing"&&(["KeyW","KeyA","KeyS","KeyD","ShiftLeft","ShiftRight","Space"].includes(x.code)&&x.preventDefault(),x.code==="KeyW"&&(ze.forward=1),x.code==="KeyS"&&(ze.forward=-1),x.code==="KeyA"&&(ze.right=-1),x.code==="KeyD"&&(ze.right=1),(x.code==="ShiftLeft"||x.code==="ShiftRight")&&(ze.sprint=!0),x.code==="Space"&&(ze.jump=!0))}),window.addEventListener("keyup",x=>{if(x.code==="Tab"&&Me.mode==="playing"&&Ge){Ge=!1,P(),document.pointerLockElement!==O.domElement&&O.domElement.requestPointerLock();return}x.code==="KeyW"&&ze.forward>0&&(ze.forward=0),x.code==="KeyS"&&ze.forward<0&&(ze.forward=0),x.code==="KeyA"&&ze.right<0&&(ze.right=0),x.code==="KeyD"&&ze.right>0&&(ze.right=0),(x.code==="ShiftLeft"||x.code==="ShiftRight")&&(ze.sprint=!1),x.code==="Space"&&(ze.jump=!1)}),window.addEventListener("blur",()=>{U(),Ge&&(Ge=!1,P())}),P();const T={clodPerfMode:g,thresholdPx:S.selection.error_threshold_px,enforce21:!0,freeze:!1,wireframe:!1,showBounds:!1,showSeamPoints:!1,showCrossLodBorders:!1,showNodeLabels:!1,showLockedBorderVertices:!1,colorByLod:g,normalColor:!1,normalDivergence:!1,divergenceGain:8,frontSideOnly:!1,recomputedNormals:!1,forceMaxLevel:"auto",textureScale:1,triplanar:!g,albedo:!g,normalMap:!1,normalIntensity:1,roughness:.9,metalness:0,textureBlendMode:zf[1],textureBlendWidth:6,loadedTextureFiles:"none",terrainBrightness:Wi.brightness,terrainContrast:Wi.contrast,terrainSaturation:Wi.saturation,terrainWarmth:Wi.warmth,sunAzimuthDeg:Kn.sunAzimuthDeg,sunElevationDeg:Kn.sunElevationDeg,sunIntensity:Kn.sunIntensity,skyIntensity:Kn.skyIntensity,groundIntensity:Kn.groundIntensity,exposure:Kn.exposure,horizonSoftness:Kn.horizonSoftness,sunDiskIntensity:Kn.sunDiskIntensity,sunGlowIntensity:Kn.sunGlowIntensity,hazeIntensity:Kn.hazeIntensity,postProcessEnabled:g?!1:wn.enabled,postProcessOpacity:wn.opacity,postProcessExposure:wn.exposure,postProcessContrast:wn.contrast,postProcessSaturation:wn.saturation,postProcessVignette:wn.vignette,postProcessDebugMode:wn.debugMode,bubble:!1,bubbleRadius:S.near_field.radius_chunks*S.page.chunk_size,tintBubble:!0,digEnabled:!0,digRadius:3,brushOp:"remove",brushShape:"sphere",brushMaterial:0,brushHeight:3,brushStrength:1,brushFalloff:0,brushFlowMs:G,audioEnabled:zh().enabled,audioVolume:zh().masterVolume,grassEnabled:!1,grassDistance:Fn.distance,grassBladeSpacing:Fn.bladeSpacing,grassBladeHeight:Fn.bladeHeight,grassBladeHeightVariation:Fn.bladeHeightVariation,grassBladeWidth:Fn.bladeWidth,grassWindStrength:Fn.windStrength,grassWindSpeed:Fn.windSpeed,grassSlopeMinY:Fn.slopeMinY,grassMinHeight:Fn.minHeight,grassMaxHeight:Fn.maxHeight,grassMaxBlades:Fn.maxBlades,grassSeed:Fn.seed,grassBladeCount:0};y&&Object.assign(T,y.manifest.state),g&&(T.clodPerfMode=!0,T.colorByLod=!0,T.albedo=!1,T.normalMap=!1,T.triplanar=!1,T.postProcessEnabled=!1,T.postProcessDebugMode="off",T.bubble=!1,T.showBounds=!1,T.showSeamPoints=!1,T.showCrossLodBorders=!1,T.showNodeLabels=!1,T.showLockedBorderVertices=!1,T.grassEnabled=!1);let p=y!==null,H=null,ee=null;const te=()=>({brightness:T.terrainBrightness,contrast:T.terrainContrast,saturation:T.terrainSaturation,warmth:T.terrainWarmth}),q=()=>({sunAzimuthDeg:T.sunAzimuthDeg,sunElevationDeg:T.sunElevationDeg,sunIntensity:T.sunIntensity,skyIntensity:T.skyIntensity,groundIntensity:T.groundIntensity,exposure:T.exposure,horizonSoftness:T.horizonSoftness,sunDiskIntensity:T.sunDiskIntensity,sunGlowIntensity:T.sunGlowIntensity,hazeIntensity:T.hazeIntensity}),ce=()=>({enabled:T.postProcessEnabled,opacity:T.postProcessOpacity,exposure:T.postProcessExposure,contrast:T.postProcessContrast,saturation:T.postProcessSaturation,vignette:T.postProcessVignette,debugMode:T.postProcessDebugMode}),w=new tE(O,ce());w.setSize(window.innerWidth,window.innerHeight);const Y=new Kw({scene:X,renderer:O,radius:Math.max(1600,re*5),settings:q(),colors:qw});Y.setVisible(!T.clodPerfMode);const N=(x,I=Y.lighting())=>{x.uniforms.uLight.value.copy(I.sunDirection),x.uniforms.uSunColor.value.copy(I.sunColor),x.uniforms.uSkyLight.value.copy(I.skyLight),x.uniforms.uGroundLight.value.copy(I.groundLight)},B=Array.from({length:ql},()=>({...Yl()}));for(let x=0;x<B.length;x++){const I=kf[x],V=as.find(le=>le.id===I.id);B[x].selectedId=I.id,B[x].scale=I.scale,B[x].heightMin=I.heightMin,B[x].heightMax=I.heightMax,B[x].name=V?.label??I.id;const se=y?.manifest.textures[x];se&&(B[x].name=se.name,B[x].selectedId=se.selectedId,B[x].scale=se.scale,B[x].heightMin=se.heightMin,B[x].heightMax=se.heightMax,B[x].customMimeType=se.mimeType??null,B[x].customExtension=se.customPath?.match(/(\.[a-z0-9]+)$/i)?.[1]??null)}let k=()=>{},W=()=>{};const J=()=>T.albedo&&B.some(x=>x.texture!==null),ae=512;let pe=null,xe=null,Le="";const Re=document.createElement("canvas");Re.width=ae,Re.height=ae;const Ye=Re.getContext("2d",{willReadFrequently:!0}),dn=(x,I)=>{if(x.every(Ie=>Ie===null))return null;const V=ae,se=V*V*4,le=new Uint8Array(se*x.length);for(let Ie=0;Ie<x.length;Ie++)Ye.save(),Ye.clearRect(0,0,V,V),Ye.translate(0,V),Ye.scale(1,-1),x[Ie]&&Ye.drawImage(x[Ie],0,0,V,V),Ye.restore(),le.set(Ye.getImageData(0,0,V,V).data,Ie*se);const Te=new Pu(le,V,V,x.length);return Te.format=Vn,Te.type=ci,Te.wrapS=wi,Te.wrapT=wi,Te.colorSpace=I,Te.generateMipmaps=!0,Te.minFilter=Ki,Te.magFilter=zn,Te.anisotropy=O.capabilities.getMaxAnisotropy(),Te.needsUpdate=!0,Te},ti=()=>{const x=B.map(I=>`${I.texture?.uuid??"_"}:${I.normalTexture?.uuid??"_"}`).join("|");x!==Le&&(Le=x,pe?.dispose(),xe?.dispose(),pe=dn(B.map(I=>I.texture?.image??null),Ln),xe=dn(B.map(I=>I.normalTexture?.image??null),oi))},Wn=()=>(ti(),{enabled:J(),triplanar:T.triplanar,normalMap:T.normalMap,normalIntensity:T.normalIntensity,roughness:T.roughness,metalness:T.metalness,textureScale:T.textureScale,blendBands:T.textureBlendMode==="blend bands",blendWidth:T.textureBlendWidth,albedoArray:pe,normalArray:xe}),Lt=()=>{const x=I=>{Kh(I,B,Wn())};for(const I of xn.values())x(I.mat);for(const{mats:I}of ie.values())for(const V of I)x(V);k(),vo()},sr=x=>{for(const I of xn.values())I.mat.uniforms.uColor.value.set(x?io[Math.min(I.node.level,3)]:12173512)},vo=()=>{const x=J();H!==null&&x!==H&&(p=!1),H=x,p||(T.colorByLod=T.clodPerfMode,ee?.updateDisplay()),sr(T.colorByLod)},xn=new Map;for(const x of F){const I=Jh(T.colorByLod?io[Math.min(x.level,io.length-1)]:12173512);Zl(I,te()),N(I);const V=new gn(hc(x.mesh),I);V.visible=!1,X.add(V),xn.set(x.id,{node:x,mesh:V,mat:I,sourceNormals:x.mesh.normals,recomputedNormals:null,selected:!1,fade:0,target:0})}const Ii=new Pi;X.add(Ii);const Rs={sphere:new ja(1,24,16),cube:new Cs(2,2,2),cylinder:new Uu(1,1,2,28)},Tn=new gn(Rs.sphere,new Lu({color:16733491,transparent:!0,opacity:.28,depthWrite:!1}));Tn.visible=!1,X.add(Tn);const Ar=new Pi;X.add(Ar);const Cr=new Pi;X.add(Cr);const Ls=new UE(X),yo=document.createElement("div");document.body.appendChild(yo);const Pr=new OE(yo);Pr.setVisible(T.showNodeLabels);const L={cellsX:re,cellsZ:re},Z=S.page.chunks_per_page,ie=new Map,oe=x=>{let I=ie.get(x.id);if(I)return I;const[V,se]=x.id.slice(3).split(",").map(Number),le=new Pi,Te=[];for(let Ie=0;Ie<Z;Ie++)for(let Je=0;Je<Z;Je++){const ct=iM(V*Z+Je,se*Z+Ie,S,L),ot=Jh(T.tintBubble?13192011:16777215);ot.uniforms.uNormalColor.value=T.normalColor,ot.uniforms.uUseTriplanar.value=T.triplanar,ot.uniforms.uNormalDivergence.value=T.normalDivergence,ot.uniforms.uDivergenceGain.value=T.divergenceGain,Zl(ot,te()),ot.side=T.frontSideOnly?In:en,Kh(ot,B,Wn()),N(ot),le.add(new gn(hc(ct),ot)),Te.push(ot)}return X.add(le),I={group:le,mats:Te},ie.set(x.id,I),I},Q=()=>({enabled:T.grassEnabled,distance:T.grassDistance,bladeSpacing:T.grassBladeSpacing,bladeHeight:T.grassBladeHeight,bladeHeightVariation:T.grassBladeHeightVariation,bladeWidth:T.grassBladeWidth,windStrength:T.grassWindStrength,windSpeed:T.grassWindSpeed,slopeMinY:T.grassSlopeMinY,minHeight:T.grassMinHeight,maxHeight:T.grassMaxHeight,maxBlades:T.grassMaxBlades,seed:T.grassSeed}),ve=()=>{const x=Y.lighting();return{light:x.sunDirection,sunColor:x.sunColor,skyLight:x.skyLight,groundLight:x.groundLight}};let Pe=null,De={split:new Set};const Oe=S.selection.transition_mode,je=S.selection.crossfade_frames>0?1/S.selection.crossfade_frames:1,$e=x=>{for(const I of xn.values())x(I.mat);for(const{mats:I}of ie.values())for(const V of I)x(V)},Ue=()=>{const x=te();$e(I=>Zl(I,x))},Qe=()=>{Y.updateSettings(q());const x=Y.lighting();$e(I=>N(I,x)),Pe?.updateLighting({light:x.sunDirection,sunColor:x.sunColor,skyLight:x.skyLight,groundLight:x.groundLight})},nt=new IM({scene:X,nodes:F.filter(x=>x.level===0),worldCells:re,settings:Q(),lighting:ve()});Pe=nt,T.grassBladeCount=nt.getBladeCount();const Et=(x,I)=>{if(Ii.clear(),T.showBounds)for(const se of x){const le=new $t(new z(se.footprint.minX,se.bounds.center[1]-se.bounds.radius,se.footprint.minZ),new z(se.footprint.maxX,se.bounds.center[1]+se.bounds.radius,se.footprint.maxZ));Ii.add(new Hb(le,new Ke(io[Math.min(se.level,3)])))}if(Ar.clear(),T.showSeamPoints){const se=[];for(let le=0;le<x.length;le++)for(let Te=le+1;Te<x.length;Te++){const Ie=x[le],Je=x[Te];if(Ie.level!==Je.level)continue;const ct=hm(Ie,Je);if(!ct)continue;const ot=_u(Ie.mesh,ct.axis,ct.aPlane,Ie.footprint),kt=_u(Je.mesh,ct.axis,ct.bPlane,Je.footprint);for(const ut of ot.positions)se.push(ut[0],ut[1],ut[2]);for(const ut of kt.positions)se.push(ut[0],ut[1],ut[2])}if(se.length>0){const le=new Ct;le.setAttribute("position",new pt(new Float32Array(se),3));const Te=new Nu({color:16720968,size:4,sizeAttenuation:!1,depthTest:!1}),Ie=new Mp(le,Te);Ie.renderOrder=20,Ar.add(Ie)}}if(Cr.clear(),!T.showCrossLodBorders)return;const V=[];for(const se of I)$E(V,se);if(V.length>0){const se=new Ct;se.setAttribute("position",new pt(new Float32Array(V),3));const le=new Du({color:65535,depthTest:!1,depthWrite:!1}),Te=new Sp(se,le);Te.renderOrder=21,Cr.add(Te)}};let Xt="",st="",ke=0,Pt=0,lt=0,bn=0,ni=[],sn="",Rr={},xt=0,$n=0,Xn="",jt="";const Lr=()=>({worldSize:A,renderedTriangles:xt,nodesByLod:Rr,forcedSplits:ke,bubbleForcedSplits:Pt,cutFrozen:T.freeze,errorThreshold:T.thresholdPx,buildStatus:C,digCostLine:Xn||void 0,polishLine:E}),Ot=()=>{const x=Me.mode==="playing"?`player: grounded=${Se.grounded}  physics p95=${Se.physicsP95Ms().toFixed(2)} ms  collider pages=${Se.lastPagesTested}`:`view: ${Me.mode}`;n.textContent=`CLOD Pages PoC — Phase 2 runtime — ${A}x${A} pages
cut: ${bn} nodes  (${sn})
tris rendered: ${xt.toLocaleString()}   2:1 forced splits: ${ke}   bubble forced splits: ${Pt}   xLOD borders: ${lt}
threshold: ${T.thresholdPx.toFixed(2)} px   avg FPS: ${$n.toFixed(1)}   ${T.forceMaxLevel==="auto"?"":`forced<=${T.forceMaxLevel}   `}${T.freeze?"[FROZEN]":""}
${E}
worker: parents pending=${Is} rebuilt=${xo} ${bo.toFixed(0)}ms   colliders loaded=${_e.loadedPageCount()}${T.clodPerfMode?"   CLOD PERF":""}
grass: ${T.grassEnabled?"enabled":"disabled"} ${T.grassBladeCount.toLocaleString()} blades
brush: ${T.digEnabled?"on":"off"}  ${T.brushOp==="add"?"raise":"dig"} ${T.brushShape} r=${T.digRadius}  edits=${qS()}
${Xn?`last: ${Xn}
`:""}${jt?`${jt}
`:""}`+x,uc(Lr())},Bt=()=>{const x=Me.mode==="playing"?Se.position:j.target,I={thresholdPx:T.thresholdPx,hysteresisMergeFactor:S.selection.hysteresis_merge_factor,enforce21:T.enforce21,nearField:{enabled:T.bubble,centerX:x.x,centerZ:x.z,radius:T.bubbleRadius,boundaryPadding:S.page.chunks_per_page*S.page.chunk_size},viewportH:O.domElement.height,fovY:Nt.degToRad(he.fov),camPos:[he.position.x,he.position.y,he.position.z],forcedMaxLevel:T.forceMaxLevel==="auto"?null:Number(T.forceMaxLevel)},{rendered:V,state:se,forcedSplits:le,nearFieldForcedSplits:Te}=zM(b.roots,I,De);De=se,ke=le,Pt=Te;const Ie=new Set(V.map(Tt=>Tt.id));for(const Tt of xn.values())Tt.selected=Ie.has(Tt.node.id),Tt.target=Tt.selected?1:0;const Je=new Map;let ct=0;for(const Tt of V)Je.set(Tt.level,(Je.get(Tt.level)??0)+1),ct+=Tt.mesh.indices.length/3;const ot=WE(V);lt=ot.length,bn=V.length,ni=V,Rr=Object.fromEntries([...Je.entries()]),sn=[...Je.keys()].sort().map(Tt=>`L${Tt}:${Je.get(Tt)}`).join("  "),xt=ct;const kt=[...Ie].sort().join("|");kt!==Xt&&(Xt=kt,Ot());const ut=`${kt}|bounds:${T.showBounds}|seams:${T.showSeamPoints}|xlod:${T.showCrossLodBorders}|locks:${T.showLockedBorderVertices}`;ut!==st&&(st=ut,Et(V,ot),Ls.rebuild(V,T.showLockedBorderVertices))},td=x=>{const I=xn.get(x.id);if(I&&(I.mesh.geometry.dispose(),I.mesh.geometry=hc(x.mesh),I.sourceNormals=x.mesh.normals,I.recomputedNormals=null,T.recomputedNormals&&I.mesh.geometry.setAttribute("normal",new pt(fc(I),3))),x.level!==0)return 0;const V=performance.now();_e.updatePage(x.id,x.mesh);const se=ie.get(x.id);if(se){X.remove(se.group);for(const le of se.group.children)le.geometry.dispose();for(const le of se.mats)le.dispose();ie.delete(x.id)}return performance.now()-V};let xo=0,bo=0,Is=0;M.onParentRebuilt=x=>{for(const I of x.changed)td(I);xo=x.parentNodes,bo=x.parentMs,Is=x.pendingParents,Xt="",st="",T.freeze||Bt(),Ot()},M.onParentsComplete=(x,I,V)=>{xo=I,bo=V,Is=0,I>0&&(Xn=`${Xn} + ancestors ${I}n ${V.toFixed(0)}ms`),Bt(),Ot()};const fm=async()=>{await M.flushParents()};let Ja=0;const Qa=async x=>{if(Ja>0)return;const I=_e.raycastSurface(x);if(!I)return;const V=T.digRadius,se={x:I.point.x,y:I.point.y,z:I.point.z,r:V,shape:T.brushShape,op:T.brushOp,material:T.brushOp==="add"?T.brushMaterial:void 0,height:T.brushHeight,strength:T.brushStrength,falloff:T.brushFalloff};XS(se),tt(T.brushOp==="add"?"terrain.raise":"terrain.dig.tick");const le=performance.now(),Te=V+mn;et=le,Ja++;try{const Ie=await M.rebuildAfterDig(se,{minX:I.point.x-Te,maxX:I.point.x+Te,minZ:I.point.z-Te,maxZ:I.point.z+Te});let Je=0;for(const ot of Ie.changed)Je+=td(ot);T.grassEnabled&&Ie.changed.length>0&&(nt.rebuildNodePatches(Ie.changed.map(ot=>ot.id)),T.grassBladeCount=nt.getBladeCount(),So?.updateDisplay()),xo=0,bo=0,Is=Ie.pendingParents,Xn=`${(performance.now()-le).toFixed(0)}ms worker LOD0 (build ${Ie.lod0Ms.toFixed(0)}ms · ${Ie.lod0Pages}p · ${Ie.chunksRemeshed}/${Ie.chunksTotal} chunks · collider ${Je.toFixed(0)}ms)`,console.log(`[${T.brushOp} ${T.brushShape} r=${V}] at (${I.point.x.toFixed(1)},${I.point.y.toFixed(1)},${I.point.z.toFixed(1)}) — ${Xn} — ${Is} ancestors queued in worker`),Xt="",st="",Bt(),Ot()}catch(Ie){throw tt("clod.rebuild.error"),Ie instanceof Error&&Ie.name==="ClodBuildError"&&tt("clod.validation.error"),Ie}finally{Ja--}};Qe(),Bt();const Ds=[];let el=performance.now(),nd=el;const pm=()=>{const x=performance.now(),I=x-el;el=x,!(I<=0)&&(Ds.push(1e3/I),Ds.length>120&&Ds.shift(),$n=Ds.reduce((V,se)=>V+se,0)/Ds.length,x-nd>=250&&(nd=x,Ot()))},mm=x=>{const I=new URLSearchParams(location.search);x?I.set("clodPerf","1"):I.delete("clodPerf"),history.replaceState(null,"",`${location.pathname}${I.toString()?`?${I.toString()}`:""}${location.hash}`)},gm=x=>{T.clodPerfMode=x,x&&(T.colorByLod=!0,T.albedo=!1,T.normalMap=!1,T.triplanar=!1,T.postProcessEnabled=!1,T.postProcessDebugMode="off",T.bubble=!1,T.showBounds=!1,T.showSeamPoints=!1,T.showCrossLodBorders=!1,T.showNodeLabels=!1,T.showLockedBorderVertices=!1,T.grassEnabled=!1,p=!0,sr(!0),Pr.setVisible(!1),Ls.rebuild(ni,!1),nt.setEnabled(!1),w.updateSettings(ce()),Lt()),Y.setVisible(!x),mm(x),st="",Bt(),Ot()},yt=new zu;yt.add({world:String(A)},"world",Bf.map(String)).name("world size (reloads)").onChange(x=>{const I=new URLSearchParams(location.search);I.set("world",x),location.search=`?${I.toString()}`}),yt.add(T,"clodPerfMode").name("CLOD perf mode").onChange(gm),yt.add(T,"thresholdPx",.1,6,.05).name("error threshold px").onChange(Bt),yt.add(T,"forceMaxLevel",["auto","0","1","2","3"]).name("force max level").onChange(()=>{De={split:new Set},Bt()}),yt.add(T,"enforce21").name("2:1 constraint").onChange(Bt),yt.add(T,"freeze").name("freeze selection").onChange(x=>{tt(x?"clod.selection.freeze.on":"clod.selection.freeze.off")}),yt.add(T,"showBounds").name("page boundaries").onChange(()=>{Bt(),tt("clod.overlay.toggle")}),yt.add(T,"showSeamPoints").name("same-LOD seam points").onChange(()=>{Bt(),tt("clod.overlay.toggle")}),yt.add(T,"showCrossLodBorders").name("cross-LOD borders").onChange(()=>{Bt(),tt("clod.overlay.toggle")}),yt.add(T,"showNodeLabels").name("show floating node labels").onChange(x=>{Pr.setVisible(x),tt("clod.overlay.toggle")}),yt.add(T,"showLockedBorderVertices").name("show locked border vertices").onChange(()=>{Bt(),tt("clod.locked-border.toggle")}),yt.add(T,"wireframe").name("wireframe").onChange(x=>{for(const I of xn.values())I.mat.wireframe=x;tt("clod.wireframe.toggle")}),yt.add(T,"normalColor").name("normal colours").onChange(x=>{$e(I=>{I.uniforms.uNormalColor.value=x})}),yt.add(T,"normalDivergence").name("normal divergence").onChange(x=>{$e(I=>{I.uniforms.uNormalDivergence.value=x})}),yt.add(T,"divergenceGain",1,32,.5).name("divergence gain").onChange(x=>{$e(I=>{I.uniforms.uDivergenceGain.value=x})}),yt.add(T,"frontSideOnly").name("front side only").onChange(x=>{$e(I=>{I.side=x?In:en,I.needsUpdate=!0})}),yt.add(T,"recomputedNormals").name("recomputed normals").onChange(x=>{for(const I of xn.values()){const V=I.mesh.geometry;V.setAttribute("normal",new pt(x?fc(I):I.sourceNormals,3)),V.attributes.normal.needsUpdate=!0}}),ee=yt.add(T,"colorByLod").name("color by LOD").onChange(x=>{p=!0,sr(x),tt("clod.lod.toggle")});const id=yt.addFolder("Audio");id.add(T,"audioEnabled").name("Audio feedback").onChange(x=>{BS(x)}),id.add(T,"audioVolume",0,1,.05).name("Master volume").onChange(x=>{kS(x)});const jn=yt.addFolder("sky + environment"),_m=[jn.add(T,"sunAzimuthDeg",0,360,1).name("sun azimuth").onChange(Qe),jn.add(T,"sunElevationDeg",5,85,1).name("sun elevation").onChange(Qe),jn.add(T,"sunIntensity",0,2.5,.05).name("sun intensity").onChange(Qe),jn.add(T,"skyIntensity",0,2,.05).name("sky fill").onChange(Qe),jn.add(T,"groundIntensity",0,2,.05).name("ground fill").onChange(Qe),jn.add(T,"exposure",.4,2,.05).name("exposure").onChange(Qe),jn.add(T,"horizonSoftness",.2,2.5,.01).name("horizon softness").onChange(Qe),jn.add(T,"sunDiskIntensity",0,4,.05).name("sun disk").onChange(Qe),jn.add(T,"sunGlowIntensity",0,4,.05).name("sun glow").onChange(Qe),jn.add(T,"hazeIntensity",0,1.5,.01).name("haze").onChange(Qe)],vm={reset:()=>{Object.assign(T,Kn),Qe();for(const x of _m)x.updateDisplay()}};jn.add(vm,"reset").name("reset");const Ns=yt.addFolder("terrain color"),ym=[Ns.add(T,"terrainBrightness",.2,2.5,.01).name("brightness").onChange(Ue),Ns.add(T,"terrainContrast",.2,2.5,.01).name("contrast").onChange(Ue),Ns.add(T,"terrainSaturation",0,2.5,.01).name("saturation").onChange(Ue),Ns.add(T,"terrainWarmth",-1,1,.01).name("warmth").onChange(Ue)],xm={reset:()=>{T.terrainBrightness=Wi.brightness,T.terrainContrast=Wi.contrast,T.terrainSaturation=Wi.saturation,T.terrainWarmth=Wi.warmth,Ue();for(const x of ym)x.updateDisplay()}};Ns.add(xm,"reset").name("reset");const Di=yt.addFolder("postprocess"),bm=[Di.add(T,"postProcessEnabled").name("enabled"),Di.add(T,"postProcessDebugMode",["output","copy","off"]).name("mode"),Di.add(T,"postProcessOpacity",0,1,.01).name("copy opacity"),Di.add(T,"postProcessExposure",.25,2.5,.01).name("pass exposure"),Di.add(T,"postProcessContrast",.25,2.5,.01).name("contrast"),Di.add(T,"postProcessSaturation",0,2.5,.01).name("saturation"),Di.add(T,"postProcessVignette",0,1.5,.01).name("vignette")],Sm={reset:()=>{T.postProcessEnabled=wn.enabled,T.postProcessOpacity=wn.opacity,T.postProcessExposure=wn.exposure,T.postProcessContrast=wn.contrast,T.postProcessSaturation=wn.saturation,T.postProcessVignette=wn.vignette,T.postProcessDebugMode=wn.debugMode,w.updateSettings(ce());for(const x of bm)x.updateDisplay()}};Di.add(Sm,"reset").name("reset");let So=null;const hi={rebuild:()=>{nt.updateSettings(Q()),nt.rebuild(),T.grassBladeCount=nt.getBladeCount(),So?.updateDisplay(),Ot()}},Mo=()=>nt.updateSettings(Q()),hn=yt.addFolder("grass shader");hn.add(T,"grassEnabled").name("enabled").onChange(x=>{nt.setEnabled(x),Ot()}),hn.add(T,"grassDistance",16,512,1).name("distance").onChange(Mo),hn.add(T,"grassBladeSpacing",.4,6,.1).name("blade spacing").onFinishChange(hi.rebuild),hn.add(T,"grassBladeHeight",.2,4,.05).name("blade height").onFinishChange(hi.rebuild),hn.add(T,"grassBladeHeightVariation",0,1,.05).name("height variation").onFinishChange(hi.rebuild),hn.add(T,"grassBladeWidth",.01,.4,.01).name("blade width").onChange(Mo),hn.add(T,"grassWindStrength",0,1.5,.01).name("wind strength").onChange(Mo),hn.add(T,"grassWindSpeed",0,4,.05).name("wind speed").onChange(Mo),hn.add(T,"grassSlopeMinY",0,1,.01).name("slope min Y").onFinishChange(hi.rebuild),hn.add(T,"grassMinHeight",0,128,1).name("min height").onFinishChange(hi.rebuild),hn.add(T,"grassMaxHeight",0,128,1).name("max height").onFinishChange(hi.rebuild),hn.add(T,"grassMaxBlades",0,1e5,1e3).name("max blades").onFinishChange(hi.rebuild),hn.add(T,"grassSeed",0,1e5,1).name("seed").onFinishChange(hi.rebuild),So=hn.add(T,"grassBladeCount").name("blade count").disable(),hn.add(hi,"rebuild").name("rebuild");const Sn=document.createElement("input");Sn.type="file",Sn.accept="image/*",Sn.multiple=!0,Sn.style.display="none",document.body.appendChild(Sn);const Ni=document.createElement("input");Ni.type="file",Ni.accept="image/*",Ni.style.display="none",document.body.appendChild(Ni);let wo=null;Ni.addEventListener("change",async()=>{const x=Ni.files?.[0];if(Ni.value="",!(x==null||wo==null)){tt("texture.load.open");try{const I=await Am(x);I?(tt("texture.load.success"),od(wo,I.texture,I.previewUrl,I.bytes,I.mimeType,I.extension)):tt("texture.load.error")}catch{tt("texture.load.error")}wo=null,An()}});let or=null;const Ir=[];let rd=null,Us=()=>{};const Mm=(x,I)=>{const V=`${x.selectedId} ${x.name}`.toLowerCase();return V.includes("water")?"water":V.includes("snow")?"snow":V.includes("rock")||V.includes("cobble")||V.includes("bedrock")?"rock":V.includes("sand")?"sand":V.includes("earth")||V.includes("terracotta")||V.includes("bark")?"earth":V.includes("grass")||V.includes("leaf")?"grass":Hf[I]??"earth"},wm=()=>{const x=B.map((I,V)=>I.texture?`${Kr(V)}: ${I.name}`:"").filter(Boolean);T.loadedTextureFiles=x.length>0?x.join(" | "):"none",rd?.updateDisplay()},tl=x=>{const I=Ir[x];if(!I)return;const V=B[x],se=I.querySelector(".texture-preview"),le=I.querySelector(".texture-slot-name"),Te=I.querySelector(".clod-texture-band"),Ie=I.querySelector(".clod-material-badge"),Je=V.texture!==null;I.classList.toggle("is-loaded",Je),I.classList.toggle("is-empty",!Je),se&&(se.style.backgroundImage=V.previewUrl?`url("${V.previewUrl}")`:"",se.style.setProperty("--clod-preview-icon",`url("${xu("terrain",Mm(V,x),64)}")`),Te?Te.textContent=Kr(x):se.textContent=V.previewUrl?"":Kr(x)),le&&(le.textContent=V.texture?V.name:"empty"),Ie&&(Ie.textContent=V.texture?"Loaded":"Empty");const ct=I.querySelector(".texture-normal-load");ct&&(ct.textContent=V.normalTexture?"Normal map ✓":"+ Normal map"),I.title=`${Kr(x)} height texture`;const ot=I.querySelector(".texture-slot-remove");ot&&(ot.hidden=B.length<=ql)},nl=()=>{for(let x=0;x<B.length;x++)tl(x)},Em=['<option value="">None</option>',...as.map(x=>`<option value="${x.id}">${x.label}</option>`),'<option value="custom">Custom file...</option>'].join(""),An=()=>{wm(),nl(),Us(),Lt()},il=(x,I,V,se,le,Te,Ie)=>{const Je=B[x];Je.texture?.dispose(),Je.previewUrl?.startsWith("blob:")&&URL.revokeObjectURL(Je.previewUrl),B[x]={...Je,texture:I,name:V,previewUrl:se,selectedId:"custom",customBytes:le.slice(),customMimeType:Te,customExtension:Ie}},sd=(x,I,V,se,le)=>{const Te=B[x];Te.texture?.dispose(),Te.previewUrl?.startsWith("blob:")&&URL.revokeObjectURL(Te.previewUrl),B[x]={...Te,texture:I,name:V,previewUrl:se,selectedId:le,customBytes:null,customMimeType:null,customExtension:null}},rl=x=>{const I=B[x];I.texture?.dispose(),I.normalTexture?.dispose(),I.previewUrl?.startsWith("blob:")&&URL.revokeObjectURL(I.previewUrl),I.normalPreviewUrl?.startsWith("blob:")&&URL.revokeObjectURL(I.normalPreviewUrl),B[x]={...I,texture:null,normalTexture:null,normalPreviewUrl:null,name:"empty",previewUrl:null,selectedId:"",customBytes:null,customMimeType:null,customExtension:null}},od=(x,I,V,se,le,Te)=>{const Ie=B[x];Ie.normalTexture?.dispose(),Ie.normalPreviewUrl?.startsWith("blob:")&&URL.revokeObjectURL(Ie.normalPreviewUrl),B[x]={...Ie,normalTexture:I,normalPreviewUrl:V,normalBytes:se.slice(),normalMimeType:le,normalExtension:Te}},Tm=x=>{const I=B[x];I.normalTexture?.dispose(),I.normalPreviewUrl?.startsWith("blob:")&&URL.revokeObjectURL(I.normalPreviewUrl),B[x]={...I,normalTexture:null,normalPreviewUrl:null,normalBytes:null,normalMimeType:null,normalExtension:null}},ad=()=>{for(let x=0;x<B.length;x++)rl(x);An()},ld=x=>{x.wrapS=wi,x.wrapT=wi,x.colorSpace=Ln,x.anisotropy=O.capabilities.getMaxAnisotropy(),x.needsUpdate=!0},cd=x=>{x.wrapS=wi,x.wrapT=wi,x.colorSpace=oi,x.anisotropy=O.capabilities.getMaxAnisotropy(),x.needsUpdate=!0},Am=async x=>{const I=new Uint8Array(await x.arrayBuffer());return new Promise(V=>{const se=URL.createObjectURL(x);new na().load(se,le=>{cd(le);const Te=x.type||"application/octet-stream";V({texture:le,previewUrl:se,bytes:I,mimeType:Te,extension:dd(x.name,Te)})},void 0,()=>{URL.revokeObjectURL(se),V(null)})})},ud={loadTexture:()=>{Us(),nl(),_t.hidden=!1,tt("texture.dialog.open")},clearTexture:ad},sl=x=>new Promise(I=>{const V=new na;V.setCrossOrigin("anonymous"),V.load(x,se=>{ld(se),I(se)},void 0,()=>I(null))}),dd=(x,I)=>{const V=x.match(/(\.[a-z0-9]+)$/i)?.[1]?.toLowerCase();return V&&V.length<=8?V:I==="image/png"?".png":I==="image/webp"?".webp":".jpg"},hd=async x=>{const I=new Uint8Array(await x.arrayBuffer());return new Promise(V=>{const se=URL.createObjectURL(x);new na().load(se,le=>{ld(le);const Te=x.type||"application/octet-stream";V({texture:le,previewUrl:se,bytes:I,mimeType:Te,extension:dd(x.name,Te)})},void 0,()=>{URL.revokeObjectURL(se),V(null)})})};Sn.addEventListener("change",async()=>{const x=Array.from(Sn.files??[]);if(x.length!==0){tt("texture.load.open");try{if(or==="all"){const I=await Promise.all(x.slice(0,rn).map(hd)),V=I.some(se=>se!==null);tt(V?"texture.load.success":"texture.load.error"),I.forEach((se,le)=>{for(;B.length<=le;)vd(!1);se&&il(le,se.texture,x[le].name,se.previewUrl,se.bytes,se.mimeType,se.extension)})}else if(typeof or=="number"){const I=await hd(x[0]);I?(tt("texture.load.success"),il(or,I.texture,x[0].name,I.previewUrl,I.bytes,I.mimeType,I.extension)):tt("texture.load.error")}}catch{tt("texture.load.error")}or=null,An(),Sn.value=""}});const _t=document.createElement("div");_t.id="texture-modal",_t.className="clod-texture-dialog",_t.hidden=!0,_t.innerHTML=`
    <section class="texture-panel clod-texture-dialog" role="dialog" aria-modal="true" aria-labelledby="texture-modal-title">
      <header>
        <h2 id="texture-modal-title">Terrain materials</h2>
        <button type="button" data-texture-close>Close</button>
      </header>
      <div class="texture-panel-body">
        <div class="texture-slot-carousel">
          <button type="button" class="texture-carousel-nav texture-carousel-prev" aria-label="Previous materials">‹</button>
          <div class="texture-slot-grid"></div>
          <button type="button" class="texture-carousel-nav texture-carousel-next" aria-label="Next materials">›</button>
        </div>
        <div class="texture-actions">
          <button type="button" data-texture-add>+ Add material</button>
          <button type="button" data-texture-load-all>Load custom set</button>
          <button type="button" data-texture-clear>Clear</button>
        </div>
      </div>
    </section>
  `,document.body.appendChild(_t);const Dr=_t.querySelector(".texture-panel"),ar=Dr.querySelector("header");let Ui=null;const Cm=(x,I)=>{const V=Dr.getBoundingClientRect(),se=Math.max(8,window.innerWidth-V.width-8),le=Math.max(8,window.innerHeight-V.height-8);Dr.style.left=`${Nt.clamp(x,8,se)}px`,Dr.style.top=`${Nt.clamp(I,8,le)}px`,Dr.style.transform="none"};ar.addEventListener("pointerdown",x=>{if(x.target.closest("button"))return;const I=Dr.getBoundingClientRect();Ui={pointerId:x.pointerId,offsetX:x.clientX-I.left,offsetY:x.clientY-I.top},ar.setPointerCapture(x.pointerId),x.preventDefault()}),ar.addEventListener("pointermove",x=>{!Ui||Ui.pointerId!==x.pointerId||Cm(x.clientX-Ui.offsetX,x.clientY-Ui.offsetY)});const fd=x=>{!Ui||Ui.pointerId!==x.pointerId||(Ui=null,ar.hasPointerCapture(x.pointerId)&&ar.releasePointerCapture(x.pointerId))};ar.addEventListener("pointerup",fd),ar.addEventListener("pointercancel",fd);const Pm=_t.querySelector(".texture-slot-carousel"),pd=_t.querySelector(".texture-slot-grid"),md=_t.querySelector(".texture-carousel-prev"),gd=_t.querySelector(".texture-carousel-next");let fi=0;const Rm=x=>{const I=Ir[x];I&&(I.querySelector(`[data-slot-texture="${x}"]`).onchange=async V=>{const se=V.target,le=se.value;if(tt("texture.slot.select"),le===""){rl(x),An();return}if(le==="custom"){or=x,Sn.multiple=!1,Sn.click(),Us();return}const Te=as.find(ct=>ct.id===le);if(!Te)return;const Ie=B[x].name;B[x].name="loading...",tl(x);const Je=await sl(Te.url);if(!Je){B[x].name=Ie,se.value=B[x].selectedId,An();return}sd(x,Je,Te.label,Te.url,Te.id),An()},I.querySelector(`[data-slot-low="${x}"]`).onchange=V=>{B[x].heightMin=Number(V.target.value),An()},I.querySelector(`[data-slot-high="${x}"]`).onchange=V=>{B[x].heightMax=Number(V.target.value),An()},I.querySelector(`[data-slot-scale="${x}"]`).onchange=V=>{B[x].scale=Number(V.target.value),An()})},_d=x=>{const I=document.createElement("article");I.className="texture-slot clod-texture-slot is-empty";const V=xu("terrain",Hf[x]??"earth",64);I.innerHTML=`
      <button class="texture-preview clod-texture-preview" type="button" style="--clod-preview-icon: url('${V}')">
        <span class="clod-texture-band">${Kr(x)}</span>
        <span class="clod-material-badge">Empty</span>
      </button>
      <span class="texture-slot-name">empty</span>
      <label class="texture-slot-select"><span>Built-in texture</span><select data-slot-texture="${x}">${Em}</select></label>
      <div class="texture-slot-params">
        <label class="texture-slot-param"><span>Scale</span><input data-slot-scale="${x}" type="number" min="${1/512}" max="${1/8}" step="${1/512}" value="${B[x].scale}" /></label>
        <label class="texture-slot-param"><span>Low</span><input data-slot-low="${x}" type="number" min="0" max="128" step="1" value="${B[x].heightMin}" /></label>
        <label class="texture-slot-param"><span>High</span><input data-slot-high="${x}" type="number" min="0" max="128" step="1" value="${B[x].heightMax}" /></label>
      </div>
      <div class="texture-slot-normal">
        <button class="texture-normal-load" type="button">+ Normal map</button>
        <button class="texture-normal-clear" type="button" title="clear normal map">✕</button>
        <button class="texture-slot-remove" type="button" title="Remove material">Remove</button>
      </div>
    `,I.querySelector(".texture-preview").addEventListener("click",()=>{or=x,Sn.multiple=!1,Sn.click()}),I.querySelector(".texture-normal-load").addEventListener("click",()=>{wo=x,Ni.click()}),I.querySelector(".texture-normal-clear").addEventListener("click",()=>{Tm(x),An()}),I.querySelector(".texture-slot-remove").addEventListener("click",()=>{Lm(x)}),Ir[x]=I,pd.appendChild(I),Rm(x),tl(x)},ol=()=>{pd.replaceChildren(),Ir.length=0;for(let x=0;x<B.length;x++)_d(x);Nr()},Nr=()=>{const x=B.length,I=us(x,fi,dc);fi=I.page,Pm.classList.toggle("texture-slot-carousel-active",I.needsCarousel),md.disabled=I.page<=0,gd.disabled=I.page>=I.maxPage;for(let se=0;se<Ir.length;se++){const le=Ir[se];le&&(le.style.display=!I.needsCarousel||se>=I.start&&se<I.end?"":"none")}const V=_t.querySelector("[data-texture-add]");V.disabled=B.length>=rn},vd=(x=!0)=>{B.length>=rn||(B.push({...Yl(),heightMin:0,heightMax:128}),_d(B.length-1),Nr(),x&&An())},Lm=x=>{B.length<=ql||(rl(x),B.splice(x,1),T.brushMaterial>=B.length&&(T.brushMaterial=0),ol(),An())};md.addEventListener("click",()=>{fi=Math.max(0,fi-1),Nr()}),gd.addEventListener("click",()=>{const{maxPage:x}=us(B.length,fi,dc);fi=Math.min(x,fi+1),Nr()}),ol(),os(_t.querySelector("[data-texture-close]"),"system","warning","Close"),os(_t.querySelector("[data-texture-load-all]"),"texture","load","Load custom set"),os(_t.querySelector("[data-texture-clear]"),"texture","slot","Clear"),Us=()=>{for(let x=0;x<B.length;x++){const I=_t.querySelector(`[data-slot-low="${x}"]`),V=_t.querySelector(`[data-slot-high="${x}"]`),se=_t.querySelector(`[data-slot-scale="${x}"]`),le=_t.querySelector(`[data-slot-texture="${x}"]`);I&&(I.value=String(B[x].heightMin)),V&&(V.value=String(B[x].heightMax)),se&&(se.value=String(B[x].scale)),le&&(le.value=B[x].selectedId)}Nr()},_t.querySelector("[data-texture-add]").addEventListener("click",()=>{vd(),fi=us(B.length,fi,dc).maxPage,Nr()}),_t.querySelector("[data-texture-load-all]").addEventListener("click",()=>{or="all",Sn.multiple=!0,Sn.click()});const al=()=>{_t.hidden||(_t.hidden=!0,tt("texture.dialog.close"))};_t.querySelector("[data-texture-clear]").addEventListener("click",ad),_t.querySelector("[data-texture-close]").addEventListener("click",al),_t.addEventListener("click",x=>{x.target===_t&&al()}),window.addEventListener("keydown",x=>{x.key==="Escape"&&al()});const yd=async(x,I)=>{if(x.length!==0){d.hidden=!1,f.textContent=I,_.textContent="90%",h.value=.9;for(const V of x){const se=as.find(Te=>Te.id===V.selectedId);if(!se)throw new Error(`Unknown texture ${V.selectedId}`);const le=await sl(se.url);if(!le)throw new Error(`Could not load texture ${V.name}`);sd(V.index,le,V.name,se.url,se.id)}}};if(y){for(;B.length<y.manifest.textures.length;)B.push({...Yl()});ol(),await yd(y.manifest.textures.filter(x=>x.source==="builtin").map(x=>({index:x.index,selectedId:x.selectedId,name:x.name})),"restoring textures");for(const x of y.manifest.textures)if(x.source!=="builtin"&&x.source==="custom"&&x.customPath){const I=y.customTextures.get(x.customPath);if(!I)throw new Error(`Imported project is missing ${x.customPath}`);const V=x.mimeType??"application/octet-stream",se=URL.createObjectURL(new Blob([new Uint8Array(I).buffer],{type:V})),le=await sl(se);if(!le)throw URL.revokeObjectURL(se),new Error(`Could not decode imported texture ${x.name}`);il(x.index,le,x.name,se,I,V,x.customPath.match(/(\.[a-z0-9]+)$/i)?.[1]??".bin")}for(const x of y.manifest.textures){if(!x.normalPath)continue;const I=y.customTextures.get(x.normalPath);if(!I)throw new Error(`Imported project is missing ${x.normalPath}`);const V=x.normalMimeType??"application/octet-stream",se=URL.createObjectURL(new Blob([new Uint8Array(I).buffer],{type:V})),le=await new Promise(Te=>{new na().load(se,Ie=>{cd(Ie),Te(Ie)},void 0,()=>Te(null))});if(!le)throw URL.revokeObjectURL(se),new Error(`Could not decode imported normal map for slot ${x.index}`);od(x.index,le,se,I,V,x.normalPath.match(/(\.[a-z0-9]+)$/i)?.[1]??".bin")}}else T.clodPerfMode?T.loadedTextureFiles="perf mode":await yd(kf.map((x,I)=>({index:I,selectedId:x.id,name:as.find(V=>V.id===x.id)?.label??x.id})),"loading textures");Us(),nl(),An(),d.hidden=!0;const Nn=yt.addFolder("terrain texture");Nn.add(T,"albedo").name("albedo").onChange(Lt),Nn.add(ud,"loadTexture").name("load albedo / normals"),Nn.add(T,"triplanar").name("triplanar").onChange(Lt),Nn.add(T,"normalMap").name("normal maps").onChange(Lt),Nn.add(T,"normalIntensity",0,3,.05).name("normal intensity").onChange(Lt),Nn.add(T,"roughness",0,1,.01).name("roughness").onChange(Lt),Nn.add(T,"metalness",0,1,.01).name("metalness").onChange(Lt),Nn.add(T,"textureScale",.25,4,.05).name("scale multiplier").onChange(Lt),Nn.add(T,"textureBlendMode",zf).name("blend mode").onChange(Lt),Nn.add(T,"textureBlendWidth",0,24,.5).name("blend height").onChange(Lt),rd=Nn.add(T,"loadedTextureFiles").name("loaded").disable(),Nn.add(ud,"clearTexture").name("clear texture");const ll=yt.addFolder("near-field bubble (§4.4)");ll.add(T,"bubble").name("enable (raw chunks)").onChange(Bt),ll.add(T,"bubbleRadius",16,160,1).name("radius (cells)").onChange(Bt),ll.add(T,"tintBubble").name("tint bubble red").onChange(x=>{for(const{mats:I}of ie.values())for(const V of I)V.uniforms.uColor.value.set(x?13192011:16777215)});const xd=yt.addFolder("digging");xd.add(T,"digEnabled").name("dig on click").onChange(Ot);const bd=xd.add(T,"digRadius",1,8,.5).name("radius (cells)").onChange(Ot);window.addEventListener("wheel",x=>{if(Me.mode!=="playing"||!x.shiftKey)return;const I=x.deltaY!==0?x.deltaY:x.deltaX;I!==0&&(T.digRadius=Nt.clamp(T.digRadius-Math.sign(I)*.5,1,8),bd.updateDisplay(),W(),Ot(),tt("terrain.brush.radius"))});const Sd=["#6b9b4d","#8c8580","#d9c78d","#f5f7ff"],Eo=document.getElementById("terraform-menu"),cl=document.createElement("div");cl.className="tf-menu-header";const ul=document.createElement("div");ul.className="tf-palette";const To=document.createElement("label");To.className="tf-edit-toggle",To.title="Show brush and sculpt controls";const Fi=document.createElement("input");Fi.type="checkbox",Fi.checked=!0,fe=Fi,To.append(Fi,document.createTextNode(" Edit")),Fi.addEventListener("change",()=>{document.body.dataset.tfEdit=Fi.checked?"true":"false",Fi.checked||(vt=!1,Tn.visible=!1),P()}),cl.appendChild(To),Eo.appendChild(cl),Eo.appendChild(ul);const Ao=document.createElement("div");Ao.className="tf-edit-section",Eo.appendChild(Ao),document.body.dataset.tfEdit="true";const dl=(x,I=Eo)=>{const V=document.createElement("div");V.className="tf-row";const se=document.createElement("span");return se.className="tf-label",se.textContent=x,V.appendChild(se),I.appendChild(V),V},Md=dl("Material",ul);Md.classList.add("tf-row-material");let pi=0;const Co=document.createElement("div");Co.className="tf-material-carousel";const lr=document.createElement("button");lr.type="button",lr.className="tf-carousel-nav tf-carousel-prev",lr.setAttribute("aria-label","Previous materials"),lr.textContent="‹";const hl=document.createElement("div");hl.className="tf-material-swatches";const cr=document.createElement("button");cr.type="button",cr.className="tf-carousel-nav tf-carousel-next",cr.setAttribute("aria-label","Next materials"),cr.textContent="›",Co.append(lr,hl,cr),Md.appendChild(Co);const Ur=[],Im=x=>{for(;Ur.length<=x;){const I=Ur.length,V=document.createElement("button");V.type="button",V.className="tf-swatch";const se=document.createElement("span");V.appendChild(se),V.addEventListener("click",()=>{V.disabled||(T.brushMaterial=I,k())}),Ur.push(V),hl.appendChild(V)}},fl=()=>{const x=B.length,I=us(x,pi);pi=I.page,Co.classList.toggle("tf-material-carousel-active",I.needsCarousel),lr.disabled=I.page<=0,cr.disabled=I.page>=I.maxPage;for(let V=0;V<Ur.length;V++){const se=V<x&&(!I.needsCarousel||V>=I.start&&V<I.end);Ur[V].style.display=se?"":"none"}};lr.addEventListener("click",()=>{pi=Math.max(0,pi-1),fl()}),cr.addEventListener("click",()=>{const{maxPage:x}=us(B.length,pi);pi=Math.min(x,pi+1),fl()});const wd=(x,I,V,se)=>{const le=I.map(({value:Ie,label:Je,icon:ct})=>{const ot=document.createElement("button");if(ot.type="button",ot.textContent=Je,ct){const[kt,ut]=ct;os(ot,kt,ut,Je)}return ot.addEventListener("click",()=>{se(Ie),Te(),tt("terrain.tool.select")}),x.appendChild(ot),{value:Ie,btn:ot}}),Te=()=>{for(const{value:Ie,btn:Je}of le)Je.setAttribute("aria-pressed",String(V()===Ie))};return Te(),Te},Fs=dl("Brush",Ao),pl=document.createElement("div");pl.className="tf-size";const mi=document.createElement("input");mi.type="range",mi.min="1",mi.max="8",mi.step="0.5",mi.value=String(T.digRadius);const Po=document.createElement("output");Po.textContent=String(T.digRadius),mi.addEventListener("input",()=>{T.digRadius=Number(mi.value),Po.textContent=String(T.digRadius),bd.updateDisplay(),Ot(),tt("terrain.brush.radius")}),pl.append(mi,Po),Fs.appendChild(pl);const Ed=document.createElement("span");Ed.style.width="8px",Fs.appendChild(Ed);const Dm=wd(Fs,[{value:"remove",label:"Dig",icon:["tool","dig"]},{value:"add",label:"Raise",icon:["tool","raise"]}],()=>T.brushOp,x=>{T.brushOp=x,Ot()}),Td=document.createElement("span");Td.style.width="6px",Fs.appendChild(Td),wd(Fs,[{value:"sphere",label:"Sphere",icon:["tool","smooth"]},{value:"cube",label:"Cube",icon:["tool","lower"]},{value:"cylinder",label:"Cyl",icon:["tool","paint"]}],()=>T.brushShape,x=>{T.brushShape=x});const Ro=(x,I,V,se,le,Te,Ie,Je=String)=>{const ct=document.createElement("div");ct.className="tf-slider";const ot=document.createElement("span");ot.className="tf-slider-label",ot.textContent=I;const kt=document.createElement("input");kt.type="range",kt.min=String(V),kt.max=String(se),kt.step=String(le),kt.value=String(Te());const ut=document.createElement("output");return ut.textContent=Je(Te()),kt.addEventListener("input",()=>{const Tt=Number(kt.value);Ie(Tt),ut.textContent=Je(Tt),Ot()}),ct.append(ot,kt,ut),x.appendChild(ct),()=>{kt.value=String(Te()),ut.textContent=Je(Te())}},Os=dl("Sculpt",Ao);Os.classList.add("tf-row-sculpt");const Nm=Ro(Os,"Strength",0,1,.05,()=>T.brushStrength,x=>{T.brushStrength=x},x=>x.toFixed(2)),Um=Ro(Os,"Height",1,16,.5,()=>T.brushHeight,x=>{T.brushHeight=x}),Fm=Ro(Os,"Falloff",0,1,.05,()=>T.brushFalloff,x=>{T.brushFalloff=x},x=>x.toFixed(2)),Om=Ro(Os,"Flow",80,600,20,()=>T.brushFlowMs,x=>{T.brushFlowMs=x},x=>`${x}ms`);k=()=>{T.brushMaterial>=B.length&&(T.brushMaterial=0),pi=zE(T.brushMaterial,pi,B.length);for(let x=0;x<B.length;x++){Im(x);const I=Ur[x],V=B[x],se=I.firstChild;I.disabled=!V.texture,I.style.backgroundImage=V.previewUrl?`url("${V.previewUrl}")`:"",I.style.backgroundColor=V.previewUrl?"transparent":Sd[x%Sd.length];const le=V.name&&V.name!=="empty"?V.name:Kr(x);se.textContent=le,I.title=le,I.setAttribute("aria-pressed",String(T.brushMaterial===x&&!I.disabled))}fl()},W=()=>{mi.value=String(T.digRadius),Po.textContent=String(T.digRadius),Dm(),Nm(),Um(),Fm(),Om()},k();const Bm=()=>({thresholdPx:T.thresholdPx,enforce21:T.enforce21,freeze:T.freeze,wireframe:T.wireframe,showBounds:T.showBounds,showSeamPoints:T.showSeamPoints,showCrossLodBorders:T.showCrossLodBorders,colorByLod:T.colorByLod,normalColor:T.normalColor,normalDivergence:T.normalDivergence,divergenceGain:T.divergenceGain,frontSideOnly:T.frontSideOnly,recomputedNormals:T.recomputedNormals,forceMaxLevel:T.forceMaxLevel,textureScale:T.textureScale,triplanar:T.triplanar,albedo:T.albedo,normalMap:T.normalMap,normalIntensity:T.normalIntensity,roughness:T.roughness,metalness:T.metalness,textureBlendMode:T.textureBlendMode,textureBlendWidth:T.textureBlendWidth,terrainBrightness:T.terrainBrightness,terrainContrast:T.terrainContrast,terrainSaturation:T.terrainSaturation,terrainWarmth:T.terrainWarmth,sunAzimuthDeg:T.sunAzimuthDeg,sunElevationDeg:T.sunElevationDeg,sunIntensity:T.sunIntensity,skyIntensity:T.skyIntensity,groundIntensity:T.groundIntensity,exposure:T.exposure,horizonSoftness:T.horizonSoftness,sunDiskIntensity:T.sunDiskIntensity,sunGlowIntensity:T.sunGlowIntensity,hazeIntensity:T.hazeIntensity,postProcessEnabled:T.postProcessEnabled,postProcessOpacity:T.postProcessOpacity,postProcessExposure:T.postProcessExposure,postProcessContrast:T.postProcessContrast,postProcessSaturation:T.postProcessSaturation,postProcessVignette:T.postProcessVignette,postProcessDebugMode:T.postProcessDebugMode,bubble:T.bubble,bubbleRadius:T.bubbleRadius,tintBubble:T.tintBubble,digEnabled:T.digEnabled,digRadius:T.digRadius,brushOp:T.brushOp,brushShape:T.brushShape,brushMaterial:T.brushMaterial,brushHeight:T.brushHeight,brushStrength:T.brushStrength,brushFalloff:T.brushFalloff,brushFlowMs:T.brushFlowMs,grassEnabled:T.grassEnabled,grassDistance:T.grassDistance,grassBladeSpacing:T.grassBladeSpacing,grassBladeHeight:T.grassBladeHeight,grassBladeHeightVariation:T.grassBladeHeightVariation,grassBladeWidth:T.grassBladeWidth,grassWindStrength:T.grassWindStrength,grassWindSpeed:T.grassWindSpeed,grassSlopeMinY:T.grassSlopeMinY,grassMinHeight:T.grassMinHeight,grassMaxHeight:T.grassMaxHeight,grassMaxBlades:T.grassMaxBlades,grassSeed:T.grassSeed}),km=()=>B.map((x,I)=>{const V=x.texture===null?"empty":x.selectedId==="custom"?"custom":"builtin",se=V==="custom"?`textures/slot-${I}${x.customExtension??".bin"}`:void 0,le=x.normalBytes?`textures/slot-${I}-normal${x.normalExtension??".bin"}`:void 0;return{index:I,source:V,name:V==="empty"?"empty":x.name,selectedId:V==="empty"?"":x.selectedId,scale:x.scale,heightMin:x.heightMin,heightMax:x.heightMax,...se?{customPath:se,mimeType:x.customMimeType??"application/octet-stream"}:{},...le?{normalPath:le,normalMimeType:x.normalMimeType??"application/octet-stream"}:{}}}),Oi=(x,I="preparing",V=0)=>{s.disabled=x,o.disabled=x,d.hidden=!x,f.textContent=I,_.textContent=`${Math.round(V*100)}%`,h.value=V,C=x?I:"ready",uc(Lr())},Ad=(x,I)=>{const V=I instanceof Error?I.message:String(I);jt=`${x} failed: ${V}`,Ot(),window.alert(`${x} failed

${V}`)},zm=async x=>{for(const I of x.manifest.textures){if(I.source==="builtin"&&!as.some(Te=>Te.id===I.selectedId))throw new Error(`project.json references unknown built-in texture ${I.selectedId}`);if(I.source!=="custom"||!I.customPath)continue;const V=x.customTextures.get(I.customPath);if(!V)throw new Error(`The archive is missing ${I.customPath}`);const se=new Blob([new Uint8Array(V).buffer],{type:I.mimeType??"application/octet-stream"}),le=URL.createObjectURL(se);try{await new Promise((Te,Ie)=>{const Je=new Image,ct=window.setTimeout(()=>Ie(new Error("image decode timed out")),5e3);Je.onload=()=>{window.clearTimeout(ct),Te()},Je.onerror=()=>{window.clearTimeout(ct),Ie(new Error("image decode failed"))},Je.src=le})}catch{throw new Error(`Custom texture ${I.name} is not a decodable image`)}finally{URL.revokeObjectURL(le)}}};s.addEventListener("click",()=>{tt("project.import.open"),a.click()}),a.addEventListener("change",async()=>{const x=a.files?.[0];if(a.value="",!!x)try{Oi(!0,"validating project archive",.2),await new Promise(le=>requestAnimationFrame(()=>le()));const I=await uE(new Uint8Array(await x.arrayBuffer()));await zm(I),Oi(!0,"staging project for rebuild",.65);const V=await dE(I);tt("project.import.success");const se=new URLSearchParams(location.search);se.set("world",String(I.manifest.worldSize)),se.set("import",V),location.search=`?${se.toString()}`}catch(I){tt("project.import.error"),Oi(!1),Ad("Project import",I)}}),o.addEventListener("click",async()=>{const x=performance.now();try{Oi(!0,"settling edited LODs",.05),await new Promise(ut=>requestAnimationFrame(()=>ut())),await fm(),Oi(!0,"exporting all LOD meshes",.25),await new Promise(ut=>requestAnimationFrame(()=>ut()));const{exportAllLodsToGlb:I}=await lo(async()=>{const{exportAllLodsToGlb:ut}=await import("./gltf_export-KgF002jY.js");return{exportAllLodsToGlb:ut}},[]),V=await I(b.nodesByLevel);Oi(!0,"packing project archive",.8);const se=km(),le=new Map;for(const ut of se){if(ut.source==="custom"&&ut.customPath){const Tt=B[ut.index].customBytes;if(!Tt)throw new Error(`Custom texture slot ${ut.index} has no source bytes`);le.set(ut.customPath,Tt)}if(ut.normalPath){const Tt=B[ut.index].normalBytes;if(!Tt)throw new Error(`Normal-map slot ${ut.index} has no source bytes`);le.set(ut.normalPath,Tt)}}const Te={schemaVersion:im,kind:"drusniel-clod-project",exportedAt:new Date().toISOString(),worldSize:A,config:structuredClone(S),state:Bm(),terrainEdits:Gh(),textures:se,camera:{position:he.position.toArray(),target:j.target.toArray()}},Ie=await cE(Te,V,le);Oi(!0,"downloading project",1);const Je=URL.createObjectURL(new Blob([new Uint8Array(Ie).buffer],{type:"application/zip"})),ct=document.createElement("a"),ot=Te.exportedAt.replace(/[:.]/g,"-");ct.href=Je,ct.download=`drusniel-clod-world-${A}-${ot}.zip`,ct.style.display="none",document.body.appendChild(ct),ct.click(),ct.remove(),setTimeout(()=>URL.revokeObjectURL(Je),6e4);const kt=performance.now()-x;jt=`export: ${(Ie.byteLength/1048576).toFixed(1)} MiB in ${(kt/1e3).toFixed(2)}s`,console.info(`[project export] ${jt}; GLB ${(V.byteLength/1048576).toFixed(1)} MiB`),Ot(),tt("project.export.success")}catch(I){tt("project.export.error"),Ad("Project export",I)}finally{Oi(!1)}}),$e(x=>{x.wireframe=T.wireframe,x.uniforms.uNormalColor.value=T.normalColor,x.uniforms.uNormalDivergence.value=T.normalDivergence,x.uniforms.uDivergenceGain.value=T.divergenceGain,x.side=T.frontSideOnly?In:en});for(const x of xn.values())x.mat.uniforms.uColor.value.set(T.colorByLod?io[Math.min(x.node.level,3)]:12173512),T.recomputedNormals&&x.mesh.geometry.setAttribute("normal",new pt(fc(x),3));Ue(),Qe(),Lt(),nt.setEnabled(T.grassEnabled),nt.updateSettings(Q()),Bt(),Ot(),window.addEventListener("resize",()=>{he.aspect=window.innerWidth/window.innerHeight,he.updateProjectionMatrix(),O.setSize(window.innerWidth,window.innerHeight),w.setSize(window.innerWidth,window.innerHeight)});let Cd=0;if(O.setAnimationLoop(()=>{const x=Math.min(Ve.getDelta(),.1);Cd+=x,pm(),Me.mode==="playing"?(we.set(-Math.sin(Ne),0,-Math.cos(Ne)),Se.update(x,ze,we),he.position.copy(Se.position).addScaledVector(Jt.DEFAULT_UP,za.eyeHeight),he.rotation.set(qe,Ne,0,"YXZ")):j.update(),Y.updateCamera(he),T.freeze||Bt(),Me.mode==="playing"&&vt&&T.digEnabled&&ge()&&document.pointerLockElement===O.domElement&&performance.now()-et>=T.brushFlowMs&&(he.getWorldDirection(Ze),Qa(new Ri(he.position.clone(),Ze.clone())));let I=null;T.digEnabled&&Me.mode==="playing"&&ge()?(he.getWorldDirection(Ze),We.origin.copy(he.position),We.direction.copy(Ze),I=_e.raycastSurface(We)):T.digEnabled&&Me.mode==="orbit"&&He&&(ue.setFromCamera(at,he),I=_e.raycastSurface(ue.ray)),I&&(Tn.position.copy(I.point),Tn.scale.set(T.digRadius,T.brushHeight,T.digRadius),Tn.geometry=Rs[T.brushShape],Tn.material.color.setHex(T.brushOp==="add"?5627238:16733491)),Tn.visible=I!==null;for(const le of xn.values()){if(Oe==="instant"){le.fade=le.target,le.mesh.visible=le.target>.5,le.mat.uniforms.uFade.value=1,le.mat.uniforms.uFadeIn.value=le.target>.5,le.mat.uniforms.uDither.value=!1;continue}le.fade<le.target?le.fade=Math.min(le.target,le.fade+je):le.fade>le.target&&(le.fade=Math.max(le.target,le.fade-je)),le.mesh.visible=le.fade>.001,le.mat.uniforms.uFade.value=le.fade,le.mat.uniforms.uFadeIn.value=le.target>.5,le.mat.uniforms.uDither.value=le.fade>.001&&le.fade<.999}for(const le of xn.values())if(T.bubble&&le.node.level===0&&le.target>.5&&Math.hypot((Me.mode==="playing"?Se.position.x:j.target.x)-(le.node.footprint.minX+le.node.footprint.maxX)/2,(Me.mode==="playing"?Se.position.z:j.target.z)-(le.node.footprint.minZ+le.node.footprint.maxZ)/2)<T.bubbleRadius)le.mesh.visible=!1,oe(le.node).group.visible=!0;else{const Ie=ie.get(le.node.id);Ie&&(Ie.group.visible=!1)}const V=Me.mode==="playing"?Se.position:j.target;nt.update(Cd,V);const se=nt.getBladeCount();se!==T.grassBladeCount&&(T.grassBladeCount=se,So?.updateDisplay()),Pr.update({nodes:ni,camera:he,viewport:O.domElement,viewportHeight:O.domElement.height,fovY:Nt.degToRad(he.fov)}),w.updateSettings(ce()),w.render(X,he)}),typeof window<"u"){window.addEventListener("click",I=>{const V=I.target;if(!V)return;(V.tagName==="BUTTON"||V.tagName==="SELECT"||V.tagName==="A"||V.tagName==="INPUT"&&V.type==="checkbox"||V.classList.contains("tf-swatch")||V.classList.contains("texture-preview")||window.getComputedStyle(V).cursor==="pointer")&&(V.tagName==="INPUT"&&V.type==="checkbox"?tt(V.checked?"ui.toggle.on":"ui.toggle.off"):tt("ui.click"))},{capture:!0,passive:!0});let x=null;window.addEventListener("pointerover",I=>{const V=I.target;if(!V||V===x)return;x=V,(V.tagName==="BUTTON"||V.tagName==="SELECT"||V.tagName==="A"||V.tagName==="INPUT"&&V.type==="checkbox"||V.classList.contains("tf-swatch")||V.classList.contains("texture-preview"))&&tt("ui.hover")},{capture:!0,passive:!0}),window.addEventListener("pointerout",()=>{x=null},{capture:!0,passive:!0})}window.addEventListener("beforeunload",()=>{Ls.dispose(),nt.dispose(),Y.dispose(),w.dispose(),M.dispose()},{once:!0})}XE().catch(n=>{const e=document.getElementById("build-progress");e&&(e.hidden=!0),document.getElementById("info").textContent="build failed: "+(n?.message??n),console.error(n)});export{pt as B,ZE as C,en as D,Pi as G,jE as I,zn as L,gn as M,oi as N,$a as P,wr as Q,po as R,Dn as S,wp as U,z as V,wb as W,Ln as a,kn as b,bp as c,Ke as d,ht as e,YE as f,op as g,Nt as h,Vn as i,mt as j,Hn as k,Bg as l,Lo as m,ml as n,Ki as o,Sr as p,wi as q,Ec as r,qE as s,KE as t,Ct as u};
