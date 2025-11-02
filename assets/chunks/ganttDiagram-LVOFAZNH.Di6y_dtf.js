import{aC as Et,aD as Mt,_ as l,g as ce,s as le,t as ue,q as de,a as fe,b as he,c as ct,d as gt,aE as ke,aF as me,aG as ye,e as ge,S as pe,aH as ve,aI as j,l as Tt,aJ as Te,aK as Nt,aL as Bt,aM as xe,aN as be,aO as we,aP as _e,aQ as De,aR as Se,aS as Ce,aT as Gt,aU as Ht,aV as Xt,aW as jt,aX as qt,aY as Ee,k as Me,j as Ie,z as Ae,u as Le}from"./theme.Bd7CHLmh.js";import"./framework.DZyPDEvU.js";var $t={exports:{}};(function(t,a){(function(s,n){t.exports=n()})(Et,function(){var s="day";return function(n,i,h){var f=function(E){return E.add(4-E.isoWeekday(),s)},_=i.prototype;_.isoWeekYear=function(){return f(this).year()},_.isoWeek=function(E){if(!this.$utils().u(E))return this.add(7*(E-this.isoWeek()),s);var p,M,V,P,B=f(this),C=(p=this.isoWeekYear(),M=this.$u,V=(M?h.utc:h)().year(p).startOf("year"),P=4-V.isoWeekday(),V.isoWeekday()>4&&(P+=7),V.add(P,s));return B.diff(C,"week")+1},_.isoWeekday=function(E){return this.$utils().u(E)?this.day()||7:this.day(this.day()%7?E:E-7)};var F=_.startOf;_.startOf=function(E,p){var M=this.$utils(),V=!!M.u(p)||p;return M.p(E)==="isoweek"?V?this.date(this.date()-(this.isoWeekday()-1)).startOf("day"):this.date(this.date()-1-(this.isoWeekday()-1)+7).endOf("day"):F.bind(this)(E,p)}}})})($t);var Ye=$t.exports;const Fe=Mt(Ye);var Kt={exports:{}};(function(t,a){(function(s,n){t.exports=n()})(Et,function(){var s={LTS:"h:mm:ss A",LT:"h:mm A",L:"MM/DD/YYYY",LL:"MMMM D, YYYY",LLL:"MMMM D, YYYY h:mm A",LLLL:"dddd, MMMM D, YYYY h:mm A"},n=/(\[[^[]*\])|([-_:/.,()\s]+)|(A|a|Q|YYYY|YY?|ww?|MM?M?M?|Do|DD?|hh?|HH?|mm?|ss?|S{1,3}|z|ZZ?)/g,i=/\d/,h=/\d\d/,f=/\d\d?/,_=/\d*[^-_:/,()\s\d]+/,F={},E=function(v){return(v=+v)+(v>68?1900:2e3)},p=function(v){return function(S){this[v]=+S}},M=[/[+-]\d\d:?(\d\d)?|Z/,function(v){(this.zone||(this.zone={})).offset=function(S){if(!S||S==="Z")return 0;var L=S.match(/([+-]|\d\d)/g),Y=60*L[1]+(+L[2]||0);return Y===0?0:L[0]==="+"?-Y:Y}(v)}],V=function(v){var S=F[v];return S&&(S.indexOf?S:S.s.concat(S.f))},P=function(v,S){var L,Y=F.meridiem;if(Y){for(var H=1;H<=24;H+=1)if(v.indexOf(Y(H,0,S))>-1){L=H>12;break}}else L=v===(S?"pm":"PM");return L},B={A:[_,function(v){this.afternoon=P(v,!1)}],a:[_,function(v){this.afternoon=P(v,!0)}],Q:[i,function(v){this.month=3*(v-1)+1}],S:[i,function(v){this.milliseconds=100*+v}],SS:[h,function(v){this.milliseconds=10*+v}],SSS:[/\d{3}/,function(v){this.milliseconds=+v}],s:[f,p("seconds")],ss:[f,p("seconds")],m:[f,p("minutes")],mm:[f,p("minutes")],H:[f,p("hours")],h:[f,p("hours")],HH:[f,p("hours")],hh:[f,p("hours")],D:[f,p("day")],DD:[h,p("day")],Do:[_,function(v){var S=F.ordinal,L=v.match(/\d+/);if(this.day=L[0],S)for(var Y=1;Y<=31;Y+=1)S(Y).replace(/\[|\]/g,"")===v&&(this.day=Y)}],w:[f,p("week")],ww:[h,p("week")],M:[f,p("month")],MM:[h,p("month")],MMM:[_,function(v){var S=V("months"),L=(V("monthsShort")||S.map(function(Y){return Y.slice(0,3)})).indexOf(v)+1;if(L<1)throw new Error;this.month=L%12||L}],MMMM:[_,function(v){var S=V("months").indexOf(v)+1;if(S<1)throw new Error;this.month=S%12||S}],Y:[/[+-]?\d+/,p("year")],YY:[h,function(v){this.year=E(v)}],YYYY:[/\d{4}/,p("year")],Z:M,ZZ:M};function C(v){var S,L;S=v,L=F&&F.formats;for(var Y=(v=S.replace(/(\[[^\]]+])|(LTS?|l{1,4}|L{1,4})/g,function(b,T,g){var w=g&&g.toUpperCase();return T||L[g]||s[g]||L[w].replace(/(\[[^\]]+])|(MMMM|MM|DD|dddd)/g,function(c,d,k){return d||k.slice(1)})})).match(n),H=Y.length,X=0;X<H;X+=1){var Q=Y[X],q=B[Q],y=q&&q[0],x=q&&q[1];Y[X]=x?{regex:y,parser:x}:Q.replace(/^\[|\]$/g,"")}return function(b){for(var T={},g=0,w=0;g<H;g+=1){var c=Y[g];if(typeof c=="string")w+=c.length;else{var d=c.regex,k=c.parser,u=b.slice(w),m=d.exec(u)[0];k.call(T,m),b=b.replace(m,"")}}return function(r){var o=r.afternoon;if(o!==void 0){var e=r.hours;o?e<12&&(r.hours+=12):e===12&&(r.hours=0),delete r.afternoon}}(T),T}}return function(v,S,L){L.p.customParseFormat=!0,v&&v.parseTwoDigitYear&&(E=v.parseTwoDigitYear);var Y=S.prototype,H=Y.parse;Y.parse=function(X){var Q=X.date,q=X.utc,y=X.args;this.$u=q;var x=y[1];if(typeof x=="string"){var b=y[2]===!0,T=y[3]===!0,g=b||T,w=y[2];T&&(w=y[2]),F=this.$locale(),!b&&w&&(F=L.Ls[w]),this.$d=function(u,m,r,o){try{if(["x","X"].indexOf(m)>-1)return new Date((m==="X"?1e3:1)*u);var e=C(m)(u),I=e.year,D=e.month,A=e.day,N=e.hours,W=e.minutes,O=e.seconds,$=e.milliseconds,it=e.zone,nt=e.week,dt=new Date,ft=A||(I||D?1:dt.getDate()),ot=I||dt.getFullYear(),z=0;I&&!D||(z=D>0?D-1:dt.getMonth());var Z,G=N||0,st=W||0,K=O||0,rt=$||0;return it?new Date(Date.UTC(ot,z,ft,G,st,K,rt+60*it.offset*1e3)):r?new Date(Date.UTC(ot,z,ft,G,st,K,rt)):(Z=new Date(ot,z,ft,G,st,K,rt),nt&&(Z=o(Z).week(nt).toDate()),Z)}catch{return new Date("")}}(Q,x,q,L),this.init(),w&&w!==!0&&(this.$L=this.locale(w).$L),g&&Q!=this.format(x)&&(this.$d=new Date("")),F={}}else if(x instanceof Array)for(var c=x.length,d=1;d<=c;d+=1){y[1]=x[d-1];var k=L.apply(this,y);if(k.isValid()){this.$d=k.$d,this.$L=k.$L,this.init();break}d===c&&(this.$d=new Date(""))}else H.call(this,X)}}})})(Kt);var We=Kt.exports;const Oe=Mt(We);var Jt={exports:{}};(function(t,a){(function(s,n){t.exports=n()})(Et,function(){return function(s,n){var i=n.prototype,h=i.format;i.format=function(f){var _=this,F=this.$locale();if(!this.isValid())return h.bind(this)(f);var E=this.$utils(),p=(f||"YYYY-MM-DDTHH:mm:ssZ").replace(/\[([^\]]+)]|Q|wo|ww|w|WW|W|zzz|z|gggg|GGGG|Do|X|x|k{1,2}|S/g,function(M){switch(M){case"Q":return Math.ceil((_.$M+1)/3);case"Do":return F.ordinal(_.$D);case"gggg":return _.weekYear();case"GGGG":return _.isoWeekYear();case"wo":return F.ordinal(_.week(),"W");case"w":case"ww":return E.s(_.week(),M==="w"?1:2,"0");case"W":case"WW":return E.s(_.isoWeek(),M==="W"?1:2,"0");case"k":case"kk":return E.s(String(_.$H===0?24:_.$H),M==="k"?1:2,"0");case"X":return Math.floor(_.$d.getTime()/1e3);case"x":return _.$d.getTime();case"z":return"["+_.offsetName()+"]";case"zzz":return"["+_.offsetName("long")+"]";default:return M}});return h.bind(this)(p)}}})})(Jt);var Ve=Jt.exports;const Pe=Mt(Ve);var _t=function(){var t=l(function(w,c,d,k){for(d=d||{},k=w.length;k--;d[w[k]]=c);return d},"o"),a=[6,8,10,12,13,14,15,16,17,18,20,21,22,23,24,25,26,27,28,29,30,31,33,35,36,38,40],s=[1,26],n=[1,27],i=[1,28],h=[1,29],f=[1,30],_=[1,31],F=[1,32],E=[1,33],p=[1,34],M=[1,9],V=[1,10],P=[1,11],B=[1,12],C=[1,13],v=[1,14],S=[1,15],L=[1,16],Y=[1,19],H=[1,20],X=[1,21],Q=[1,22],q=[1,23],y=[1,25],x=[1,35],b={trace:l(function(){},"trace"),yy:{},symbols_:{error:2,start:3,gantt:4,document:5,EOF:6,line:7,SPACE:8,statement:9,NL:10,weekday:11,weekday_monday:12,weekday_tuesday:13,weekday_wednesday:14,weekday_thursday:15,weekday_friday:16,weekday_saturday:17,weekday_sunday:18,weekend:19,weekend_friday:20,weekend_saturday:21,dateFormat:22,inclusiveEndDates:23,topAxis:24,axisFormat:25,tickInterval:26,excludes:27,includes:28,todayMarker:29,title:30,acc_title:31,acc_title_value:32,acc_descr:33,acc_descr_value:34,acc_descr_multiline_value:35,section:36,clickStatement:37,taskTxt:38,taskData:39,click:40,callbackname:41,callbackargs:42,href:43,clickStatementDebug:44,$accept:0,$end:1},terminals_:{2:"error",4:"gantt",6:"EOF",8:"SPACE",10:"NL",12:"weekday_monday",13:"weekday_tuesday",14:"weekday_wednesday",15:"weekday_thursday",16:"weekday_friday",17:"weekday_saturday",18:"weekday_sunday",20:"weekend_friday",21:"weekend_saturday",22:"dateFormat",23:"inclusiveEndDates",24:"topAxis",25:"axisFormat",26:"tickInterval",27:"excludes",28:"includes",29:"todayMarker",30:"title",31:"acc_title",32:"acc_title_value",33:"acc_descr",34:"acc_descr_value",35:"acc_descr_multiline_value",36:"section",38:"taskTxt",39:"taskData",40:"click",41:"callbackname",42:"callbackargs",43:"href"},productions_:[0,[3,3],[5,0],[5,2],[7,2],[7,1],[7,1],[7,1],[11,1],[11,1],[11,1],[11,1],[11,1],[11,1],[11,1],[19,1],[19,1],[9,1],[9,1],[9,1],[9,1],[9,1],[9,1],[9,1],[9,1],[9,1],[9,1],[9,1],[9,2],[9,2],[9,1],[9,1],[9,1],[9,2],[37,2],[37,3],[37,3],[37,4],[37,3],[37,4],[37,2],[44,2],[44,3],[44,3],[44,4],[44,3],[44,4],[44,2]],performAction:l(function(c,d,k,u,m,r,o){var e=r.length-1;switch(m){case 1:return r[e-1];case 2:this.$=[];break;case 3:r[e-1].push(r[e]),this.$=r[e-1];break;case 4:case 5:this.$=r[e];break;case 6:case 7:this.$=[];break;case 8:u.setWeekday("monday");break;case 9:u.setWeekday("tuesday");break;case 10:u.setWeekday("wednesday");break;case 11:u.setWeekday("thursday");break;case 12:u.setWeekday("friday");break;case 13:u.setWeekday("saturday");break;case 14:u.setWeekday("sunday");break;case 15:u.setWeekend("friday");break;case 16:u.setWeekend("saturday");break;case 17:u.setDateFormat(r[e].substr(11)),this.$=r[e].substr(11);break;case 18:u.enableInclusiveEndDates(),this.$=r[e].substr(18);break;case 19:u.TopAxis(),this.$=r[e].substr(8);break;case 20:u.setAxisFormat(r[e].substr(11)),this.$=r[e].substr(11);break;case 21:u.setTickInterval(r[e].substr(13)),this.$=r[e].substr(13);break;case 22:u.setExcludes(r[e].substr(9)),this.$=r[e].substr(9);break;case 23:u.setIncludes(r[e].substr(9)),this.$=r[e].substr(9);break;case 24:u.setTodayMarker(r[e].substr(12)),this.$=r[e].substr(12);break;case 27:u.setDiagramTitle(r[e].substr(6)),this.$=r[e].substr(6);break;case 28:this.$=r[e].trim(),u.setAccTitle(this.$);break;case 29:case 30:this.$=r[e].trim(),u.setAccDescription(this.$);break;case 31:u.addSection(r[e].substr(8)),this.$=r[e].substr(8);break;case 33:u.addTask(r[e-1],r[e]),this.$="task";break;case 34:this.$=r[e-1],u.setClickEvent(r[e-1],r[e],null);break;case 35:this.$=r[e-2],u.setClickEvent(r[e-2],r[e-1],r[e]);break;case 36:this.$=r[e-2],u.setClickEvent(r[e-2],r[e-1],null),u.setLink(r[e-2],r[e]);break;case 37:this.$=r[e-3],u.setClickEvent(r[e-3],r[e-2],r[e-1]),u.setLink(r[e-3],r[e]);break;case 38:this.$=r[e-2],u.setClickEvent(r[e-2],r[e],null),u.setLink(r[e-2],r[e-1]);break;case 39:this.$=r[e-3],u.setClickEvent(r[e-3],r[e-1],r[e]),u.setLink(r[e-3],r[e-2]);break;case 40:this.$=r[e-1],u.setLink(r[e-1],r[e]);break;case 41:case 47:this.$=r[e-1]+" "+r[e];break;case 42:case 43:case 45:this.$=r[e-2]+" "+r[e-1]+" "+r[e];break;case 44:case 46:this.$=r[e-3]+" "+r[e-2]+" "+r[e-1]+" "+r[e];break}},"anonymous"),table:[{3:1,4:[1,2]},{1:[3]},t(a,[2,2],{5:3}),{6:[1,4],7:5,8:[1,6],9:7,10:[1,8],11:17,12:s,13:n,14:i,15:h,16:f,17:_,18:F,19:18,20:E,21:p,22:M,23:V,24:P,25:B,26:C,27:v,28:S,29:L,30:Y,31:H,33:X,35:Q,36:q,37:24,38:y,40:x},t(a,[2,7],{1:[2,1]}),t(a,[2,3]),{9:36,11:17,12:s,13:n,14:i,15:h,16:f,17:_,18:F,19:18,20:E,21:p,22:M,23:V,24:P,25:B,26:C,27:v,28:S,29:L,30:Y,31:H,33:X,35:Q,36:q,37:24,38:y,40:x},t(a,[2,5]),t(a,[2,6]),t(a,[2,17]),t(a,[2,18]),t(a,[2,19]),t(a,[2,20]),t(a,[2,21]),t(a,[2,22]),t(a,[2,23]),t(a,[2,24]),t(a,[2,25]),t(a,[2,26]),t(a,[2,27]),{32:[1,37]},{34:[1,38]},t(a,[2,30]),t(a,[2,31]),t(a,[2,32]),{39:[1,39]},t(a,[2,8]),t(a,[2,9]),t(a,[2,10]),t(a,[2,11]),t(a,[2,12]),t(a,[2,13]),t(a,[2,14]),t(a,[2,15]),t(a,[2,16]),{41:[1,40],43:[1,41]},t(a,[2,4]),t(a,[2,28]),t(a,[2,29]),t(a,[2,33]),t(a,[2,34],{42:[1,42],43:[1,43]}),t(a,[2,40],{41:[1,44]}),t(a,[2,35],{43:[1,45]}),t(a,[2,36]),t(a,[2,38],{42:[1,46]}),t(a,[2,37]),t(a,[2,39])],defaultActions:{},parseError:l(function(c,d){if(d.recoverable)this.trace(c);else{var k=new Error(c);throw k.hash=d,k}},"parseError"),parse:l(function(c){var d=this,k=[0],u=[],m=[null],r=[],o=this.table,e="",I=0,D=0,A=2,N=1,W=r.slice.call(arguments,1),O=Object.create(this.lexer),$={yy:{}};for(var it in this.yy)Object.prototype.hasOwnProperty.call(this.yy,it)&&($.yy[it]=this.yy[it]);O.setInput(c,$.yy),$.yy.lexer=O,$.yy.parser=this,typeof O.yylloc>"u"&&(O.yylloc={});var nt=O.yylloc;r.push(nt);var dt=O.options&&O.options.ranges;typeof $.yy.parseError=="function"?this.parseError=$.yy.parseError:this.parseError=Object.getPrototypeOf(this).parseError;function ft(U){k.length=k.length-2*U,m.length=m.length-U,r.length=r.length-U}l(ft,"popStack");function ot(){var U;return U=u.pop()||O.lex()||N,typeof U!="number"&&(U instanceof Array&&(u=U,U=u.pop()),U=d.symbols_[U]||U),U}l(ot,"lex");for(var z,Z,G,st,K={},rt,J,Rt,yt;;){if(Z=k[k.length-1],this.defaultActions[Z]?G=this.defaultActions[Z]:((z===null||typeof z>"u")&&(z=ot()),G=o[Z]&&o[Z][z]),typeof G>"u"||!G.length||!G[0]){var wt="";yt=[];for(rt in o[Z])this.terminals_[rt]&&rt>A&&yt.push("'"+this.terminals_[rt]+"'");O.showPosition?wt="Parse error on line "+(I+1)+`:
`+O.showPosition()+`
Expecting `+yt.join(", ")+", got '"+(this.terminals_[z]||z)+"'":wt="Parse error on line "+(I+1)+": Unexpected "+(z==N?"end of input":"'"+(this.terminals_[z]||z)+"'"),this.parseError(wt,{text:O.match,token:this.terminals_[z]||z,line:O.yylineno,loc:nt,expected:yt})}if(G[0]instanceof Array&&G.length>1)throw new Error("Parse Error: multiple actions possible at state: "+Z+", token: "+z);switch(G[0]){case 1:k.push(z),m.push(O.yytext),r.push(O.yylloc),k.push(G[1]),z=null,D=O.yyleng,e=O.yytext,I=O.yylineno,nt=O.yylloc;break;case 2:if(J=this.productions_[G[1]][1],K.$=m[m.length-J],K._$={first_line:r[r.length-(J||1)].first_line,last_line:r[r.length-1].last_line,first_column:r[r.length-(J||1)].first_column,last_column:r[r.length-1].last_column},dt&&(K._$.range=[r[r.length-(J||1)].range[0],r[r.length-1].range[1]]),st=this.performAction.apply(K,[e,D,I,$.yy,G[1],m,r].concat(W)),typeof st<"u")return st;J&&(k=k.slice(0,-1*J*2),m=m.slice(0,-1*J),r=r.slice(0,-1*J)),k.push(this.productions_[G[1]][0]),m.push(K.$),r.push(K._$),Rt=o[k[k.length-2]][k[k.length-1]],k.push(Rt);break;case 3:return!0}}return!0},"parse")},T=function(){var w={EOF:1,parseError:l(function(d,k){if(this.yy.parser)this.yy.parser.parseError(d,k);else throw new Error(d)},"parseError"),setInput:l(function(c,d){return this.yy=d||this.yy||{},this._input=c,this._more=this._backtrack=this.done=!1,this.yylineno=this.yyleng=0,this.yytext=this.matched=this.match="",this.conditionStack=["INITIAL"],this.yylloc={first_line:1,first_column:0,last_line:1,last_column:0},this.options.ranges&&(this.yylloc.range=[0,0]),this.offset=0,this},"setInput"),input:l(function(){var c=this._input[0];this.yytext+=c,this.yyleng++,this.offset++,this.match+=c,this.matched+=c;var d=c.match(/(?:\r\n?|\n).*/g);return d?(this.yylineno++,this.yylloc.last_line++):this.yylloc.last_column++,this.options.ranges&&this.yylloc.range[1]++,this._input=this._input.slice(1),c},"input"),unput:l(function(c){var d=c.length,k=c.split(/(?:\r\n?|\n)/g);this._input=c+this._input,this.yytext=this.yytext.substr(0,this.yytext.length-d),this.offset-=d;var u=this.match.split(/(?:\r\n?|\n)/g);this.match=this.match.substr(0,this.match.length-1),this.matched=this.matched.substr(0,this.matched.length-1),k.length-1&&(this.yylineno-=k.length-1);var m=this.yylloc.range;return this.yylloc={first_line:this.yylloc.first_line,last_line:this.yylineno+1,first_column:this.yylloc.first_column,last_column:k?(k.length===u.length?this.yylloc.first_column:0)+u[u.length-k.length].length-k[0].length:this.yylloc.first_column-d},this.options.ranges&&(this.yylloc.range=[m[0],m[0]+this.yyleng-d]),this.yyleng=this.yytext.length,this},"unput"),more:l(function(){return this._more=!0,this},"more"),reject:l(function(){if(this.options.backtrack_lexer)this._backtrack=!0;else return this.parseError("Lexical error on line "+(this.yylineno+1)+`. You can only invoke reject() in the lexer when the lexer is of the backtracking persuasion (options.backtrack_lexer = true).
`+this.showPosition(),{text:"",token:null,line:this.yylineno});return this},"reject"),less:l(function(c){this.unput(this.match.slice(c))},"less"),pastInput:l(function(){var c=this.matched.substr(0,this.matched.length-this.match.length);return(c.length>20?"...":"")+c.substr(-20).replace(/\n/g,"")},"pastInput"),upcomingInput:l(function(){var c=this.match;return c.length<20&&(c+=this._input.substr(0,20-c.length)),(c.substr(0,20)+(c.length>20?"...":"")).replace(/\n/g,"")},"upcomingInput"),showPosition:l(function(){var c=this.pastInput(),d=new Array(c.length+1).join("-");return c+this.upcomingInput()+`
`+d+"^"},"showPosition"),test_match:l(function(c,d){var k,u,m;if(this.options.backtrack_lexer&&(m={yylineno:this.yylineno,yylloc:{first_line:this.yylloc.first_line,last_line:this.last_line,first_column:this.yylloc.first_column,last_column:this.yylloc.last_column},yytext:this.yytext,match:this.match,matches:this.matches,matched:this.matched,yyleng:this.yyleng,offset:this.offset,_more:this._more,_input:this._input,yy:this.yy,conditionStack:this.conditionStack.slice(0),done:this.done},this.options.ranges&&(m.yylloc.range=this.yylloc.range.slice(0))),u=c[0].match(/(?:\r\n?|\n).*/g),u&&(this.yylineno+=u.length),this.yylloc={first_line:this.yylloc.last_line,last_line:this.yylineno+1,first_column:this.yylloc.last_column,last_column:u?u[u.length-1].length-u[u.length-1].match(/\r?\n?/)[0].length:this.yylloc.last_column+c[0].length},this.yytext+=c[0],this.match+=c[0],this.matches=c,this.yyleng=this.yytext.length,this.options.ranges&&(this.yylloc.range=[this.offset,this.offset+=this.yyleng]),this._more=!1,this._backtrack=!1,this._input=this._input.slice(c[0].length),this.matched+=c[0],k=this.performAction.call(this,this.yy,this,d,this.conditionStack[this.conditionStack.length-1]),this.done&&this._input&&(this.done=!1),k)return k;if(this._backtrack){for(var r in m)this[r]=m[r];return!1}return!1},"test_match"),next:l(function(){if(this.done)return this.EOF;this._input||(this.done=!0);var c,d,k,u;this._more||(this.yytext="",this.match="");for(var m=this._currentRules(),r=0;r<m.length;r++)if(k=this._input.match(this.rules[m[r]]),k&&(!d||k[0].length>d[0].length)){if(d=k,u=r,this.options.backtrack_lexer){if(c=this.test_match(k,m[r]),c!==!1)return c;if(this._backtrack){d=!1;continue}else return!1}else if(!this.options.flex)break}return d?(c=this.test_match(d,m[u]),c!==!1?c:!1):this._input===""?this.EOF:this.parseError("Lexical error on line "+(this.yylineno+1)+`. Unrecognized text.
`+this.showPosition(),{text:"",token:null,line:this.yylineno})},"next"),lex:l(function(){var d=this.next();return d||this.lex()},"lex"),begin:l(function(d){this.conditionStack.push(d)},"begin"),popState:l(function(){var d=this.conditionStack.length-1;return d>0?this.conditionStack.pop():this.conditionStack[0]},"popState"),_currentRules:l(function(){return this.conditionStack.length&&this.conditionStack[this.conditionStack.length-1]?this.conditions[this.conditionStack[this.conditionStack.length-1]].rules:this.conditions.INITIAL.rules},"_currentRules"),topState:l(function(d){return d=this.conditionStack.length-1-Math.abs(d||0),d>=0?this.conditionStack[d]:"INITIAL"},"topState"),pushState:l(function(d){this.begin(d)},"pushState"),stateStackSize:l(function(){return this.conditionStack.length},"stateStackSize"),options:{"case-insensitive":!0},performAction:l(function(d,k,u,m){switch(u){case 0:return this.begin("open_directive"),"open_directive";case 1:return this.begin("acc_title"),31;case 2:return this.popState(),"acc_title_value";case 3:return this.begin("acc_descr"),33;case 4:return this.popState(),"acc_descr_value";case 5:this.begin("acc_descr_multiline");break;case 6:this.popState();break;case 7:return"acc_descr_multiline_value";case 8:break;case 9:break;case 10:break;case 11:return 10;case 12:break;case 13:break;case 14:this.begin("href");break;case 15:this.popState();break;case 16:return 43;case 17:this.begin("callbackname");break;case 18:this.popState();break;case 19:this.popState(),this.begin("callbackargs");break;case 20:return 41;case 21:this.popState();break;case 22:return 42;case 23:this.begin("click");break;case 24:this.popState();break;case 25:return 40;case 26:return 4;case 27:return 22;case 28:return 23;case 29:return 24;case 30:return 25;case 31:return 26;case 32:return 28;case 33:return 27;case 34:return 29;case 35:return 12;case 36:return 13;case 37:return 14;case 38:return 15;case 39:return 16;case 40:return 17;case 41:return 18;case 42:return 20;case 43:return 21;case 44:return"date";case 45:return 30;case 46:return"accDescription";case 47:return 36;case 48:return 38;case 49:return 39;case 50:return":";case 51:return 6;case 52:return"INVALID"}},"anonymous"),rules:[/^(?:%%\{)/i,/^(?:accTitle\s*:\s*)/i,/^(?:(?!\n||)*[^\n]*)/i,/^(?:accDescr\s*:\s*)/i,/^(?:(?!\n||)*[^\n]*)/i,/^(?:accDescr\s*\{\s*)/i,/^(?:[\}])/i,/^(?:[^\}]*)/i,/^(?:%%(?!\{)*[^\n]*)/i,/^(?:[^\}]%%*[^\n]*)/i,/^(?:%%*[^\n]*[\n]*)/i,/^(?:[\n]+)/i,/^(?:\s+)/i,/^(?:%[^\n]*)/i,/^(?:href[\s]+["])/i,/^(?:["])/i,/^(?:[^"]*)/i,/^(?:call[\s]+)/i,/^(?:\([\s]*\))/i,/^(?:\()/i,/^(?:[^(]*)/i,/^(?:\))/i,/^(?:[^)]*)/i,/^(?:click[\s]+)/i,/^(?:[\s\n])/i,/^(?:[^\s\n]*)/i,/^(?:gantt\b)/i,/^(?:dateFormat\s[^#\n;]+)/i,/^(?:inclusiveEndDates\b)/i,/^(?:topAxis\b)/i,/^(?:axisFormat\s[^#\n;]+)/i,/^(?:tickInterval\s[^#\n;]+)/i,/^(?:includes\s[^#\n;]+)/i,/^(?:excludes\s[^#\n;]+)/i,/^(?:todayMarker\s[^\n;]+)/i,/^(?:weekday\s+monday\b)/i,/^(?:weekday\s+tuesday\b)/i,/^(?:weekday\s+wednesday\b)/i,/^(?:weekday\s+thursday\b)/i,/^(?:weekday\s+friday\b)/i,/^(?:weekday\s+saturday\b)/i,/^(?:weekday\s+sunday\b)/i,/^(?:weekend\s+friday\b)/i,/^(?:weekend\s+saturday\b)/i,/^(?:\d\d\d\d-\d\d-\d\d\b)/i,/^(?:title\s[^\n]+)/i,/^(?:accDescription\s[^#\n;]+)/i,/^(?:section\s[^\n]+)/i,/^(?:[^:\n]+)/i,/^(?::[^#\n;]+)/i,/^(?::)/i,/^(?:$)/i,/^(?:.)/i],conditions:{acc_descr_multiline:{rules:[6,7],inclusive:!1},acc_descr:{rules:[4],inclusive:!1},acc_title:{rules:[2],inclusive:!1},callbackargs:{rules:[21,22],inclusive:!1},callbackname:{rules:[18,19,20],inclusive:!1},href:{rules:[15,16],inclusive:!1},click:{rules:[24,25],inclusive:!1},INITIAL:{rules:[0,1,3,5,8,9,10,11,12,13,14,17,23,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52],inclusive:!0}}};return w}();b.lexer=T;function g(){this.yy={}}return l(g,"Parser"),g.prototype=b,b.Parser=g,new g}();_t.parser=_t;var ze=_t;j.extend(Fe);j.extend(Oe);j.extend(Pe);var Ut={friday:5,saturday:6},tt="",It="",At=void 0,Lt="",ht=[],kt=[],Yt=new Map,Ft=[],xt=[],ut="",Wt="",te=["active","done","crit","milestone","vert"],Ot=[],mt=!1,Vt=!1,Pt="sunday",bt="saturday",Dt=0,Re=l(function(){Ft=[],xt=[],ut="",Ot=[],pt=0,Ct=void 0,vt=void 0,R=[],tt="",It="",Wt="",At=void 0,Lt="",ht=[],kt=[],mt=!1,Vt=!1,Dt=0,Yt=new Map,Ae(),Pt="sunday",bt="saturday"},"clear"),Ne=l(function(t){It=t},"setAxisFormat"),Be=l(function(){return It},"getAxisFormat"),Ge=l(function(t){At=t},"setTickInterval"),He=l(function(){return At},"getTickInterval"),Xe=l(function(t){Lt=t},"setTodayMarker"),je=l(function(){return Lt},"getTodayMarker"),qe=l(function(t){tt=t},"setDateFormat"),Ue=l(function(){mt=!0},"enableInclusiveEndDates"),Ze=l(function(){return mt},"endDatesAreInclusive"),Qe=l(function(){Vt=!0},"enableTopAxis"),$e=l(function(){return Vt},"topAxisEnabled"),Ke=l(function(t){Wt=t},"setDisplayMode"),Je=l(function(){return Wt},"getDisplayMode"),tr=l(function(){return tt},"getDateFormat"),er=l(function(t){ht=t.toLowerCase().split(/[\s,]+/)},"setIncludes"),rr=l(function(){return ht},"getIncludes"),sr=l(function(t){kt=t.toLowerCase().split(/[\s,]+/)},"setExcludes"),ar=l(function(){return kt},"getExcludes"),ir=l(function(){return Yt},"getLinks"),nr=l(function(t){ut=t,Ft.push(t)},"addSection"),or=l(function(){return Ft},"getSections"),cr=l(function(){let t=Zt();const a=10;let s=0;for(;!t&&s<a;)t=Zt(),s++;return xt=R,xt},"getTasks"),ee=l(function(t,a,s,n){const i=t.format(a.trim()),h=t.format("YYYY-MM-DD");return n.includes(i)||n.includes(h)?!1:s.includes("weekends")&&(t.isoWeekday()===Ut[bt]||t.isoWeekday()===Ut[bt]+1)||s.includes(t.format("dddd").toLowerCase())?!0:s.includes(i)||s.includes(h)},"isInvalidDate"),lr=l(function(t){Pt=t},"setWeekday"),ur=l(function(){return Pt},"getWeekday"),dr=l(function(t){bt=t},"setWeekend"),re=l(function(t,a,s,n){if(!s.length||t.manualEndTime)return;let i;t.startTime instanceof Date?i=j(t.startTime):i=j(t.startTime,a,!0),i=i.add(1,"d");let h;t.endTime instanceof Date?h=j(t.endTime):h=j(t.endTime,a,!0);const[f,_]=fr(i,h,a,s,n);t.endTime=f.toDate(),t.renderEndTime=_},"checkTaskDates"),fr=l(function(t,a,s,n,i){let h=!1,f=null;for(;t<=a;)h||(f=a.toDate()),h=ee(t,s,n,i),h&&(a=a.add(1,"d")),t=t.add(1,"d");return[a,f]},"fixTaskDates"),St=l(function(t,a,s){if(s=s.trim(),(a.trim()==="x"||a.trim()==="X")&&/^\d+$/.test(s))return new Date(Number(s));const i=/^after\s+(?<ids>[\d\w- ]+)/.exec(s);if(i!==null){let f=null;for(const F of i.groups.ids.split(" ")){let E=at(F);E!==void 0&&(!f||E.endTime>f.endTime)&&(f=E)}if(f)return f.endTime;const _=new Date;return _.setHours(0,0,0,0),_}let h=j(s,a.trim(),!0);if(h.isValid())return h.toDate();{Tt.debug("Invalid date:"+s),Tt.debug("With date format:"+a.trim());const f=new Date(s);if(f===void 0||isNaN(f.getTime())||f.getFullYear()<-1e4||f.getFullYear()>1e4)throw new Error("Invalid date:"+s);return f}},"getStartDate"),se=l(function(t){const a=/^(\d+(?:\.\d+)?)([Mdhmswy]|ms)$/.exec(t.trim());return a!==null?[Number.parseFloat(a[1]),a[2]]:[NaN,"ms"]},"parseDuration"),ae=l(function(t,a,s,n=!1){s=s.trim();const h=/^until\s+(?<ids>[\d\w- ]+)/.exec(s);if(h!==null){let p=null;for(const V of h.groups.ids.split(" ")){let P=at(V);P!==void 0&&(!p||P.startTime<p.startTime)&&(p=P)}if(p)return p.startTime;const M=new Date;return M.setHours(0,0,0,0),M}let f=j(s,a.trim(),!0);if(f.isValid())return n&&(f=f.add(1,"d")),f.toDate();let _=j(t);const[F,E]=se(s);if(!Number.isNaN(F)){const p=_.add(F,E);p.isValid()&&(_=p)}return _.toDate()},"getEndDate"),pt=0,lt=l(function(t){return t===void 0?(pt=pt+1,"task"+pt):t},"parseId"),hr=l(function(t,a){let s;a.substr(0,1)===":"?s=a.substr(1,a.length):s=a;const n=s.split(","),i={};zt(n,i,te);for(let f=0;f<n.length;f++)n[f]=n[f].trim();let h="";switch(n.length){case 1:i.id=lt(),i.startTime=t.endTime,h=n[0];break;case 2:i.id=lt(),i.startTime=St(void 0,tt,n[0]),h=n[1];break;case 3:i.id=lt(n[0]),i.startTime=St(void 0,tt,n[1]),h=n[2];break}return h&&(i.endTime=ae(i.startTime,tt,h,mt),i.manualEndTime=j(h,"YYYY-MM-DD",!0).isValid(),re(i,tt,kt,ht)),i},"compileData"),kr=l(function(t,a){let s;a.substr(0,1)===":"?s=a.substr(1,a.length):s=a;const n=s.split(","),i={};zt(n,i,te);for(let h=0;h<n.length;h++)n[h]=n[h].trim();switch(n.length){case 1:i.id=lt(),i.startTime={type:"prevTaskEnd",id:t},i.endTime={data:n[0]};break;case 2:i.id=lt(),i.startTime={type:"getStartDate",startData:n[0]},i.endTime={data:n[1]};break;case 3:i.id=lt(n[0]),i.startTime={type:"getStartDate",startData:n[1]},i.endTime={data:n[2]};break}return i},"parseData"),Ct,vt,R=[],ie={},mr=l(function(t,a){const s={section:ut,type:ut,processed:!1,manualEndTime:!1,renderEndTime:null,raw:{data:a},task:t,classes:[]},n=kr(vt,a);s.raw.startTime=n.startTime,s.raw.endTime=n.endTime,s.id=n.id,s.prevTaskId=vt,s.active=n.active,s.done=n.done,s.crit=n.crit,s.milestone=n.milestone,s.vert=n.vert,s.order=Dt,Dt++;const i=R.push(s);vt=s.id,ie[s.id]=i-1},"addTask"),at=l(function(t){const a=ie[t];return R[a]},"findTaskById"),yr=l(function(t,a){const s={section:ut,type:ut,description:t,task:t,classes:[]},n=hr(Ct,a);s.startTime=n.startTime,s.endTime=n.endTime,s.id=n.id,s.active=n.active,s.done=n.done,s.crit=n.crit,s.milestone=n.milestone,s.vert=n.vert,Ct=s,xt.push(s)},"addTaskOrg"),Zt=l(function(){const t=l(function(s){const n=R[s];let i="";switch(R[s].raw.startTime.type){case"prevTaskEnd":{const h=at(n.prevTaskId);n.startTime=h.endTime;break}case"getStartDate":i=St(void 0,tt,R[s].raw.startTime.startData),i&&(R[s].startTime=i);break}return R[s].startTime&&(R[s].endTime=ae(R[s].startTime,tt,R[s].raw.endTime.data,mt),R[s].endTime&&(R[s].processed=!0,R[s].manualEndTime=j(R[s].raw.endTime.data,"YYYY-MM-DD",!0).isValid(),re(R[s],tt,kt,ht))),R[s].processed},"compileTask");let a=!0;for(const[s,n]of R.entries())t(s),a=a&&n.processed;return a},"compileTasks"),gr=l(function(t,a){let s=a;ct().securityLevel!=="loose"&&(s=Ie(a)),t.split(",").forEach(function(n){at(n)!==void 0&&(oe(n,()=>{window.open(s,"_self")}),Yt.set(n,s))}),ne(t,"clickable")},"setLink"),ne=l(function(t,a){t.split(",").forEach(function(s){let n=at(s);n!==void 0&&n.classes.push(a)})},"setClass"),pr=l(function(t,a,s){if(ct().securityLevel!=="loose"||a===void 0)return;let n=[];if(typeof s=="string"){n=s.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);for(let h=0;h<n.length;h++){let f=n[h].trim();f.startsWith('"')&&f.endsWith('"')&&(f=f.substr(1,f.length-2)),n[h]=f}}n.length===0&&n.push(t),at(t)!==void 0&&oe(t,()=>{Le.runFunc(a,...n)})},"setClickFun"),oe=l(function(t,a){Ot.push(function(){const s=document.querySelector(`[id="${t}"]`);s!==null&&s.addEventListener("click",function(){a()})},function(){const s=document.querySelector(`[id="${t}-text"]`);s!==null&&s.addEventListener("click",function(){a()})})},"pushFun"),vr=l(function(t,a,s){t.split(",").forEach(function(n){pr(n,a,s)}),ne(t,"clickable")},"setClickEvent"),Tr=l(function(t){Ot.forEach(function(a){a(t)})},"bindFunctions"),xr={getConfig:l(()=>ct().gantt,"getConfig"),clear:Re,setDateFormat:qe,getDateFormat:tr,enableInclusiveEndDates:Ue,endDatesAreInclusive:Ze,enableTopAxis:Qe,topAxisEnabled:$e,setAxisFormat:Ne,getAxisFormat:Be,setTickInterval:Ge,getTickInterval:He,setTodayMarker:Xe,getTodayMarker:je,setAccTitle:he,getAccTitle:fe,setDiagramTitle:de,getDiagramTitle:ue,setDisplayMode:Ke,getDisplayMode:Je,setAccDescription:le,getAccDescription:ce,addSection:nr,getSections:or,getTasks:cr,addTask:mr,findTaskById:at,addTaskOrg:yr,setIncludes:er,getIncludes:rr,setExcludes:sr,getExcludes:ar,setClickEvent:vr,setLink:gr,getLinks:ir,bindFunctions:Tr,parseDuration:se,isInvalidDate:ee,setWeekday:lr,getWeekday:ur,setWeekend:dr};function zt(t,a,s){let n=!0;for(;n;)n=!1,s.forEach(function(i){const h="^\\s*"+i+"\\s*$",f=new RegExp(h);t[0].match(f)&&(a[i]=!0,t.shift(1),n=!0)})}l(zt,"getTaskTags");var br=l(function(){Tt.debug("Something is calling, setConf, remove the call")},"setConf"),Qt={monday:Ce,tuesday:Se,wednesday:De,thursday:_e,friday:we,saturday:be,sunday:xe},wr=l((t,a)=>{let s=[...t].map(()=>-1/0),n=[...t].sort((h,f)=>h.startTime-f.startTime||h.order-f.order),i=0;for(const h of n)for(let f=0;f<s.length;f++)if(h.startTime>=s[f]){s[f]=h.endTime,h.order=f+a,f>i&&(i=f);break}return i},"getMaxIntersections"),et,_r=l(function(t,a,s,n){const i=ct().gantt,h=ct().securityLevel;let f;h==="sandbox"&&(f=gt("#i"+a));const _=h==="sandbox"?gt(f.nodes()[0].contentDocument.body):gt("body"),F=h==="sandbox"?f.nodes()[0].contentDocument:document,E=F.getElementById(a);et=E.parentElement.offsetWidth,et===void 0&&(et=1200),i.useWidth!==void 0&&(et=i.useWidth);const p=n.db.getTasks();let M=[];for(const y of p)M.push(y.type);M=q(M);const V={};let P=2*i.topPadding;if(n.db.getDisplayMode()==="compact"||i.displayMode==="compact"){const y={};for(const b of p)y[b.section]===void 0?y[b.section]=[b]:y[b.section].push(b);let x=0;for(const b of Object.keys(y)){const T=wr(y[b],x)+1;x+=T,P+=T*(i.barHeight+i.barGap),V[b]=T}}else{P+=p.length*(i.barHeight+i.barGap);for(const y of M)V[y]=p.filter(x=>x.type===y).length}E.setAttribute("viewBox","0 0 "+et+" "+P);const B=_.select(`[id="${a}"]`),C=ke().domain([me(p,function(y){return y.startTime}),ye(p,function(y){return y.endTime})]).rangeRound([0,et-i.leftPadding-i.rightPadding]);function v(y,x){const b=y.startTime,T=x.startTime;let g=0;return b>T?g=1:b<T&&(g=-1),g}l(v,"taskCompare"),p.sort(v),S(p,et,P),ge(B,P,et,i.useMaxWidth),B.append("text").text(n.db.getDiagramTitle()).attr("x",et/2).attr("y",i.titleTopMargin).attr("class","titleText");function S(y,x,b){const T=i.barHeight,g=T+i.barGap,w=i.topPadding,c=i.leftPadding,d=pe().domain([0,M.length]).range(["#00B9FA","#F95002"]).interpolate(ve);Y(g,w,c,x,b,y,n.db.getExcludes(),n.db.getIncludes()),H(c,w,x,b),L(y,g,w,c,T,d,x),X(g,w),Q(c,w,x,b)}l(S,"makeGantt");function L(y,x,b,T,g,w,c){y.sort((o,e)=>o.vert===e.vert?0:o.vert?1:-1);const k=[...new Set(y.map(o=>o.order))].map(o=>y.find(e=>e.order===o));B.append("g").selectAll("rect").data(k).enter().append("rect").attr("x",0).attr("y",function(o,e){return e=o.order,e*x+b-2}).attr("width",function(){return c-i.rightPadding/2}).attr("height",x).attr("class",function(o){for(const[e,I]of M.entries())if(o.type===I)return"section section"+e%i.numberSectionStyles;return"section section0"}).enter();const u=B.append("g").selectAll("rect").data(y).enter(),m=n.db.getLinks();if(u.append("rect").attr("id",function(o){return o.id}).attr("rx",3).attr("ry",3).attr("x",function(o){return o.milestone?C(o.startTime)+T+.5*(C(o.endTime)-C(o.startTime))-.5*g:C(o.startTime)+T}).attr("y",function(o,e){return e=o.order,o.vert?i.gridLineStartPadding:e*x+b}).attr("width",function(o){return o.milestone?g:o.vert?.08*g:C(o.renderEndTime||o.endTime)-C(o.startTime)}).attr("height",function(o){return o.vert?p.length*(i.barHeight+i.barGap)+i.barHeight*2:g}).attr("transform-origin",function(o,e){return e=o.order,(C(o.startTime)+T+.5*(C(o.endTime)-C(o.startTime))).toString()+"px "+(e*x+b+.5*g).toString()+"px"}).attr("class",function(o){const e="task";let I="";o.classes.length>0&&(I=o.classes.join(" "));let D=0;for(const[N,W]of M.entries())o.type===W&&(D=N%i.numberSectionStyles);let A="";return o.active?o.crit?A+=" activeCrit":A=" active":o.done?o.crit?A=" doneCrit":A=" done":o.crit&&(A+=" crit"),A.length===0&&(A=" task"),o.milestone&&(A=" milestone "+A),o.vert&&(A=" vert "+A),A+=D,A+=" "+I,e+A}),u.append("text").attr("id",function(o){return o.id+"-text"}).text(function(o){return o.task}).attr("font-size",i.fontSize).attr("x",function(o){let e=C(o.startTime),I=C(o.renderEndTime||o.endTime);if(o.milestone&&(e+=.5*(C(o.endTime)-C(o.startTime))-.5*g,I=e+g),o.vert)return C(o.startTime)+T;const D=this.getBBox().width;return D>I-e?I+D+1.5*i.leftPadding>c?e+T-5:I+T+5:(I-e)/2+e+T}).attr("y",function(o,e){return o.vert?i.gridLineStartPadding+p.length*(i.barHeight+i.barGap)+60:(e=o.order,e*x+i.barHeight/2+(i.fontSize/2-2)+b)}).attr("text-height",g).attr("class",function(o){const e=C(o.startTime);let I=C(o.endTime);o.milestone&&(I=e+g);const D=this.getBBox().width;let A="";o.classes.length>0&&(A=o.classes.join(" "));let N=0;for(const[O,$]of M.entries())o.type===$&&(N=O%i.numberSectionStyles);let W="";return o.active&&(o.crit?W="activeCritText"+N:W="activeText"+N),o.done?o.crit?W=W+" doneCritText"+N:W=W+" doneText"+N:o.crit&&(W=W+" critText"+N),o.milestone&&(W+=" milestoneText"),o.vert&&(W+=" vertText"),D>I-e?I+D+1.5*i.leftPadding>c?A+" taskTextOutsideLeft taskTextOutside"+N+" "+W:A+" taskTextOutsideRight taskTextOutside"+N+" "+W+" width-"+D:A+" taskText taskText"+N+" "+W+" width-"+D}),ct().securityLevel==="sandbox"){let o;o=gt("#i"+a);const e=o.nodes()[0].contentDocument;u.filter(function(I){return m.has(I.id)}).each(function(I){var D=e.querySelector("#"+I.id),A=e.querySelector("#"+I.id+"-text");const N=D.parentNode;var W=e.createElement("a");W.setAttribute("xlink:href",m.get(I.id)),W.setAttribute("target","_top"),N.appendChild(W),W.appendChild(D),W.appendChild(A)})}}l(L,"drawRects");function Y(y,x,b,T,g,w,c,d){if(c.length===0&&d.length===0)return;let k,u;for(const{startTime:D,endTime:A}of w)(k===void 0||D<k)&&(k=D),(u===void 0||A>u)&&(u=A);if(!k||!u)return;if(j(u).diff(j(k),"year")>5){Tt.warn("The difference between the min and max time is more than 5 years. This will cause performance issues. Skipping drawing exclude days.");return}const m=n.db.getDateFormat(),r=[];let o=null,e=j(k);for(;e.valueOf()<=u;)n.db.isInvalidDate(e,m,c,d)?o?o.end=e:o={start:e,end:e}:o&&(r.push(o),o=null),e=e.add(1,"d");B.append("g").selectAll("rect").data(r).enter().append("rect").attr("id",D=>"exclude-"+D.start.format("YYYY-MM-DD")).attr("x",D=>C(D.start.startOf("day"))+b).attr("y",i.gridLineStartPadding).attr("width",D=>C(D.end.endOf("day"))-C(D.start.startOf("day"))).attr("height",g-x-i.gridLineStartPadding).attr("transform-origin",function(D,A){return(C(D.start)+b+.5*(C(D.end)-C(D.start))).toString()+"px "+(A*y+.5*g).toString()+"px"}).attr("class","exclude-range")}l(Y,"drawExcludeDays");function H(y,x,b,T){const g=n.db.getDateFormat(),w=n.db.getAxisFormat();let c;w?c=w:g==="D"?c="%d":c=i.axisFormat??"%Y-%m-%d";let d=Te(C).tickSize(-T+x+i.gridLineStartPadding).tickFormat(Nt(c));const u=/^([1-9]\d*)(millisecond|second|minute|hour|day|week|month)$/.exec(n.db.getTickInterval()||i.tickInterval);if(u!==null){const m=u[1],r=u[2],o=n.db.getWeekday()||i.weekday;switch(r){case"millisecond":d.ticks(qt.every(m));break;case"second":d.ticks(jt.every(m));break;case"minute":d.ticks(Xt.every(m));break;case"hour":d.ticks(Ht.every(m));break;case"day":d.ticks(Gt.every(m));break;case"week":d.ticks(Qt[o].every(m));break;case"month":d.ticks(Bt.every(m));break}}if(B.append("g").attr("class","grid").attr("transform","translate("+y+", "+(T-50)+")").call(d).selectAll("text").style("text-anchor","middle").attr("fill","#000").attr("stroke","none").attr("font-size",10).attr("dy","1em"),n.db.topAxisEnabled()||i.topAxis){let m=Ee(C).tickSize(-T+x+i.gridLineStartPadding).tickFormat(Nt(c));if(u!==null){const r=u[1],o=u[2],e=n.db.getWeekday()||i.weekday;switch(o){case"millisecond":m.ticks(qt.every(r));break;case"second":m.ticks(jt.every(r));break;case"minute":m.ticks(Xt.every(r));break;case"hour":m.ticks(Ht.every(r));break;case"day":m.ticks(Gt.every(r));break;case"week":m.ticks(Qt[e].every(r));break;case"month":m.ticks(Bt.every(r));break}}B.append("g").attr("class","grid").attr("transform","translate("+y+", "+x+")").call(m).selectAll("text").style("text-anchor","middle").attr("fill","#000").attr("stroke","none").attr("font-size",10)}}l(H,"makeGrid");function X(y,x){let b=0;const T=Object.keys(V).map(g=>[g,V[g]]);B.append("g").selectAll("text").data(T).enter().append(function(g){const w=g[0].split(Me.lineBreakRegex),c=-(w.length-1)/2,d=F.createElementNS("http://www.w3.org/2000/svg","text");d.setAttribute("dy",c+"em");for(const[k,u]of w.entries()){const m=F.createElementNS("http://www.w3.org/2000/svg","tspan");m.setAttribute("alignment-baseline","central"),m.setAttribute("x","10"),k>0&&m.setAttribute("dy","1em"),m.textContent=u,d.appendChild(m)}return d}).attr("x",10).attr("y",function(g,w){if(w>0)for(let c=0;c<w;c++)return b+=T[w-1][1],g[1]*y/2+b*y+x;else return g[1]*y/2+x}).attr("font-size",i.sectionFontSize).attr("class",function(g){for(const[w,c]of M.entries())if(g[0]===c)return"sectionTitle sectionTitle"+w%i.numberSectionStyles;return"sectionTitle"})}l(X,"vertLabels");function Q(y,x,b,T){const g=n.db.getTodayMarker();if(g==="off")return;const w=B.append("g").attr("class","today"),c=new Date,d=w.append("line");d.attr("x1",C(c)+y).attr("x2",C(c)+y).attr("y1",i.titleTopMargin).attr("y2",T-i.titleTopMargin).attr("class","today"),g!==""&&d.attr("style",g.replace(/,/g,";"))}l(Q,"drawToday");function q(y){const x={},b=[];for(let T=0,g=y.length;T<g;++T)Object.prototype.hasOwnProperty.call(x,y[T])||(x[y[T]]=!0,b.push(y[T]));return b}l(q,"checkUnique")},"draw"),Dr={setConf:br,draw:_r},Sr=l(t=>`
  .mermaid-main-font {
        font-family: ${t.fontFamily};
  }

  .exclude-range {
    fill: ${t.excludeBkgColor};
  }

  .section {
    stroke: none;
    opacity: 0.2;
  }

  .section0 {
    fill: ${t.sectionBkgColor};
  }

  .section2 {
    fill: ${t.sectionBkgColor2};
  }

  .section1,
  .section3 {
    fill: ${t.altSectionBkgColor};
    opacity: 0.2;
  }

  .sectionTitle0 {
    fill: ${t.titleColor};
  }

  .sectionTitle1 {
    fill: ${t.titleColor};
  }

  .sectionTitle2 {
    fill: ${t.titleColor};
  }

  .sectionTitle3 {
    fill: ${t.titleColor};
  }

  .sectionTitle {
    text-anchor: start;
    font-family: ${t.fontFamily};
  }


  /* Grid and axis */

  .grid .tick {
    stroke: ${t.gridColor};
    opacity: 0.8;
    shape-rendering: crispEdges;
  }

  .grid .tick text {
    font-family: ${t.fontFamily};
    fill: ${t.textColor};
  }

  .grid path {
    stroke-width: 0;
  }


  /* Today line */

  .today {
    fill: none;
    stroke: ${t.todayLineColor};
    stroke-width: 2px;
  }


  /* Task styling */

  /* Default task */

  .task {
    stroke-width: 2;
  }

  .taskText {
    text-anchor: middle;
    font-family: ${t.fontFamily};
  }

  .taskTextOutsideRight {
    fill: ${t.taskTextDarkColor};
    text-anchor: start;
    font-family: ${t.fontFamily};
  }

  .taskTextOutsideLeft {
    fill: ${t.taskTextDarkColor};
    text-anchor: end;
  }


  /* Special case clickable */

  .task.clickable {
    cursor: pointer;
  }

  .taskText.clickable {
    cursor: pointer;
    fill: ${t.taskTextClickableColor} !important;
    font-weight: bold;
  }

  .taskTextOutsideLeft.clickable {
    cursor: pointer;
    fill: ${t.taskTextClickableColor} !important;
    font-weight: bold;
  }

  .taskTextOutsideRight.clickable {
    cursor: pointer;
    fill: ${t.taskTextClickableColor} !important;
    font-weight: bold;
  }


  /* Specific task settings for the sections*/

  .taskText0,
  .taskText1,
  .taskText2,
  .taskText3 {
    fill: ${t.taskTextColor};
  }

  .task0,
  .task1,
  .task2,
  .task3 {
    fill: ${t.taskBkgColor};
    stroke: ${t.taskBorderColor};
  }

  .taskTextOutside0,
  .taskTextOutside2
  {
    fill: ${t.taskTextOutsideColor};
  }

  .taskTextOutside1,
  .taskTextOutside3 {
    fill: ${t.taskTextOutsideColor};
  }


  /* Active task */

  .active0,
  .active1,
  .active2,
  .active3 {
    fill: ${t.activeTaskBkgColor};
    stroke: ${t.activeTaskBorderColor};
  }

  .activeText0,
  .activeText1,
  .activeText2,
  .activeText3 {
    fill: ${t.taskTextDarkColor} !important;
  }


  /* Completed task */

  .done0,
  .done1,
  .done2,
  .done3 {
    stroke: ${t.doneTaskBorderColor};
    fill: ${t.doneTaskBkgColor};
    stroke-width: 2;
  }

  .doneText0,
  .doneText1,
  .doneText2,
  .doneText3 {
    fill: ${t.taskTextDarkColor} !important;
  }


  /* Tasks on the critical line */

  .crit0,
  .crit1,
  .crit2,
  .crit3 {
    stroke: ${t.critBorderColor};
    fill: ${t.critBkgColor};
    stroke-width: 2;
  }

  .activeCrit0,
  .activeCrit1,
  .activeCrit2,
  .activeCrit3 {
    stroke: ${t.critBorderColor};
    fill: ${t.activeTaskBkgColor};
    stroke-width: 2;
  }

  .doneCrit0,
  .doneCrit1,
  .doneCrit2,
  .doneCrit3 {
    stroke: ${t.critBorderColor};
    fill: ${t.doneTaskBkgColor};
    stroke-width: 2;
    cursor: pointer;
    shape-rendering: crispEdges;
  }

  .milestone {
    transform: rotate(45deg) scale(0.8,0.8);
  }

  .milestoneText {
    font-style: italic;
  }
  .doneCritText0,
  .doneCritText1,
  .doneCritText2,
  .doneCritText3 {
    fill: ${t.taskTextDarkColor} !important;
  }

  .vert {
    stroke: ${t.vertLineColor};
  }

  .vertText {
    font-size: 15px;
    text-anchor: middle;
    fill: ${t.vertLineColor} !important;
  }

  .activeCritText0,
  .activeCritText1,
  .activeCritText2,
  .activeCritText3 {
    fill: ${t.taskTextDarkColor} !important;
  }

  .titleText {
    text-anchor: middle;
    font-size: 18px;
    fill: ${t.titleColor||t.textColor};
    font-family: ${t.fontFamily};
  }
`,"getStyles"),Cr=Sr,Ir={parser:ze,db:xr,renderer:Dr,styles:Cr};export{Ir as diagram};
