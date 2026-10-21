(function (root, factory) {
  typeof exports === "object" && typeof module !== "undefined"
    ? factory(exports)
    : typeof define === "function" && define.amd
    ? define(["exports"], factory)
    : ((root = typeof globalThis !== "undefined" ? globalThis : root || self),
      factory((root.FSRS = {})));
})(this, function (exports) {
  "use strict";

  // --- Enums & States ---
  var State = ((s) => {
    s[(s.New = 0)] = "New";
    s[(s.Learning = 1)] = "Learning";
    s[(s.Review = 2)] = "Review";
    s[(s.Relearning = 3)] = "Relearning";
    return s;
  })(State || {});

  var Rating = ((r) => {
    r[(r.Manual = 0)] = "Manual";
    r[(r.Again = 1)] = "Again";
    r[(r.Hard = 2)] = "Hard";
    r[(r.Good = 3)] = "Good";
    r[(r.Easy = 4)] = "Easy";
    return r;
  })(Rating || {});

  // --- Object Helper Utilities ---
  const defineProperty = Object.defineProperty;
  const defineProperties = Object.defineProperties;
  const getDescriptors = Object.getOwnPropertyDescriptors;
  const getSymbols = Object.getOwnPropertySymbols;
  const hasOwn = Object.prototype.hasOwnProperty;
  const isEnumerable = Object.prototype.propertyIsEnumerable;

  const setProp = (obj, key, val) =>
    key in obj
      ? defineProperty(obj, key, {
          enumerable: true,
          configurable: true,
          writable: true,
          value: val,
        })
      : (obj[key] = val);

  const assignProps = (target, source) => {
    for (var key in source || (source = {}))
      if (hasOwn.call(source, key)) setProp(target, key, source[key]);
    if (getSymbols)
      for (var sym of getSymbols(source))
        if (isEnumerable.call(source, sym)) setProp(target, sym, source[sym]);
    return target;
  };

  const merge = (target, source) => defineProperties(target, getDescriptors(source));

  // --- Type Converter ---
  class TypeConvert {
    static card(card) {
      return merge(assignProps({}, card), {
        state: TypeConvert.state(card.state),
        due: TypeConvert.time(card.due),
        last_review: card.last_review ? TypeConvert.time(card.last_review) : undefined,
      });
    }

    static rating(val) {
      if (typeof val === "string") {
        const titleCase = val.charAt(0).toUpperCase() + val.slice(1).toLowerCase();
        const r = Rating[titleCase];
        if (r === undefined) throw new Error(`Invalid rating:[${val}]`);
        return r;
      } else if (typeof val === "number") {
        return val;
      }
      throw new Error(`Invalid rating:[${val}]`);
    }

    static state(val) {
      if (typeof val === "string") {
        const titleCase = val.charAt(0).toUpperCase() + val.slice(1).toLowerCase();
        const s = State[titleCase];
        if (s === undefined) throw new Error(`Invalid state:[${val}]`);
        return s;
      } else if (typeof val === "number") {
        return val;
      }
      throw new Error(`Invalid state:[${val}]`);
    }

    static time(val) {
      if (typeof val === "object" && val instanceof Date) return val;
      if (typeof val === "string") {
        const timestamp = Date.parse(val);
        if (isNaN(timestamp)) throw new Error(`Invalid date:[${val}]`);
        return new Date(timestamp);
      } else if (typeof val === "number") {
        return new Date(val);
      }
      throw new Error(`Invalid date:[${val}]`);
    }

    static review_log(log) {
      return merge(assignProps({}, log), {
        due: TypeConvert.time(log.due),
        rating: TypeConvert.rating(log.rating),
        state: TypeConvert.state(log.state),
        review: TypeConvert.time(log.review),
      });
    }
  }

  // --- Date Prototype Extensions ---
  const FSRS_VERSION = "4.7.1";

  Date.prototype.scheduler = function (amount, isDays) {
    return dateScheduler(this, amount, isDays);
  };
  Date.prototype.diff = function (otherDate, unit) {
    return dateDiff(this, otherDate, unit);
  };
  Date.prototype.format = function () {
    return formatDate(this);
  };
  Date.prototype.dueFormat = function (otherDate, showUnit, unitNames) {
    return showDiffMessage(this, otherDate, showUnit, unitNames);
  };

  function dateScheduler(baseDate, amount, isDays) {
    const ms = isDays ? amount * 86400000 : amount * 60000;
    return new Date(TypeConvert.time(baseDate).getTime() + ms);
  }

  function dateDiff(date1, date2, unit) {
    if (!date1 || !date2) throw new Error("Invalid date");
    const diffMs = TypeConvert.time(date1).getTime() - TypeConvert.time(date2).getTime();
    switch (unit) {
      case "days":
        return Math.floor(diffMs / 86400000);
      case "minutes":
        return Math.floor(diffMs / 60000);
      default:
        return 0;
    }
  }

  function formatDate(d) {
    const t = TypeConvert.time(d);
    const pad = (n) => (n < 10 ? `0${n}` : `${n}`);
    return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())} ${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())}`;
  }

  const TIME_DIVISORS = [60, 60, 24, 31, 12];
  const TIME_UNITS = ["second", "min", "hour", "day", "month", "year"];

  function showDiffMessage(date1, date2, showUnit, units = TIME_UNITS) {
    date1 = TypeConvert.time(date1);
    date2 = TypeConvert.time(date2);
    if (units.length !== TIME_UNITS.length) units = TIME_UNITS;

    let delta = (date1.getTime() - date2.getTime()) / 1000;
    let idx = 0;
    for (; idx < TIME_DIVISORS.length && !(delta < TIME_DIVISORS[idx]); idx++) {
      delta /= TIME_DIVISORS[idx];
    }
    return `${Math.floor(delta)}${showUnit ? units[idx] : ""}`;
  }

  const fixDate = (d) => TypeConvert.time(d);
  const fixState = (s) => TypeConvert.state(s);
  const fixRating = (r) => TypeConvert.rating(r);

  const GRADES = Object.freeze([Rating.Again, Rating.Hard, Rating.Good, Rating.Easy]);
  const FUZZ_RANGES = [
    { start: 2.5, end: 7, factor: 0.15 },
    { start: 7, end: 20, factor: 0.1 },
    { start: 20, end: Infinity, factor: 0.05 },
  ];

  function getFuzzRange(interval, elapsedDays, maxInterval) {
    let delta = 1;
    for (const range of FUZZ_RANGES) {
      delta += range.factor * Math.max(Math.min(interval, range.end) - range.start, 0);
    }
    interval = Math.min(interval, maxInterval);
    let minIvl = Math.max(2, Math.round(interval - delta));
    const maxIvl = Math.min(Math.round(interval + delta), maxInterval);

    if (interval > elapsedDays) {
      minIvl = Math.max(minIvl, elapsedDays + 1);
    }
    minIvl = Math.min(minIvl, maxIvl);
    return { min_ivl: minIvl, max_ivl: maxIvl };
  }

  function clamp(val, min, max) {
    return Math.min(Math.max(val, min), max);
  }

  function dateDiffInDays(d1, d2) {
    const utc1 = Date.UTC(d1.getUTCFullYear(), d1.getUTCMonth(), d1.getUTCDate());
    const utc2 = Date.UTC(d2.getUTCFullYear(), d2.getUTCMonth(), d2.getUTCDate());
    return Math.floor((utc2 - utc1) / 86400000);
  }

  // --- Default Constants ---
  const DEFAULT_REQUEST_RETENTION = 0.9;
  const DEFAULT_MAX_INTERVAL = 36500;
  const DEFAULT_WEIGHTS = Object.freeze([
    0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575,
    0.1192, 1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621,
  ]);
  const DEFAULT_ENABLE_FUZZ = false;
  const DEFAULT_ENABLE_SHORT_TERM = true;
  const FULL_VERSION_STR = `v${FSRS_VERSION} using FSRS-5.0`;
  const S_MIN = 0.01;
  const INIT_S_MAX = 100;

  const CLAMP_PARAMETERS = Object.freeze([
    Object.freeze([S_MIN, INIT_S_MAX]),
    Object.freeze([S_MIN, INIT_S_MAX]),
    Object.freeze([S_MIN, INIT_S_MAX]),
    Object.freeze([S_MIN, INIT_S_MAX]),
    Object.freeze([1, 10]),
    Object.freeze([0.001, 4]),
    Object.freeze([0.001, 4]),
    Object.freeze([0.001, 0.75]),
    Object.freeze([0, 4.5]),
    Object.freeze([0, 0.8]),
    Object.freeze([0.001, 3.5]),
    Object.freeze([0.001, 5]),
    Object.freeze([0.001, 0.25]),
    Object.freeze([0.001, 0.9]),
    Object.freeze([0, 4]),
    Object.freeze([0, 1]),
    Object.freeze([1, 6]),
    Object.freeze([0, 2]),
    Object.freeze([0, 2]),
  ]);

  const generatorParameters = (params) => {
    let w = [...DEFAULT_WEIGHTS];
    if (params?.w) {
      if (params.w.length === 19) {
        w = [...params.w];
      } else if (params.w.length === 17) {
        w = params.w.concat([0, 0]);
        w[4] = +(w[5] * 2 + w[4]).toFixed(8);
        w[5] = +(Math.log(w[5] * 3 + 1) / 3).toFixed(8);
        w[6] = +(w[6] + 0.5).toFixed(8);
        console.debug("[FSRS V5] auto fill w to 19 length");
      }
    }
    w = w.map((val, idx) => clamp(val, CLAMP_PARAMETERS[idx][0], CLAMP_PARAMETERS[idx][1]));

    return {
      request_retention: params?.request_retention || DEFAULT_REQUEST_RETENTION,
      maximum_interval: params?.maximum_interval || DEFAULT_MAX_INTERVAL,
      w: w,
      enable_fuzz: params?.enable_fuzz ?? DEFAULT_ENABLE_FUZZ,
      enable_short_term: params?.enable_short_term ?? DEFAULT_ENABLE_SHORT_TERM,
    };
  };

  function createEmptyCard(now, modifier) {
    const emptyCard = {
      due: now ? TypeConvert.time(now) : new Date(),
      stability: 0,
      difficulty: 0,
      elapsed_days: 0,
      scheduled_days: 0,
      reps: 0,
      lapses: 0,
      state: State.New,
      last_review: undefined,
    };
    return modifier && typeof modifier === "function" ? modifier(emptyCard) : emptyCard;
  }

  // --- PRNG (Alea Generator for Fuzzing) ---
  const setField = (inst, field, val) =>
    defineProperty(inst, typeof field !== "symbol" ? field + "" : field, {
      enumerable: true,
      configurable: true,
      writable: true,
      value: val,
    });

  class AleaPRNG {
    constructor(seed) {
      setField(this, "c");
      setField(this, "s0");
      setField(this, "s1");
      setField(this, "s2");

      const mash = Mash();
      this.c = 1;
      this.s0 = mash(" ");
      this.s1 = mash(" ");
      this.s2 = mash(" ");
      if (seed == null) seed = +new Date();
      this.s0 -= mash(seed);
      if (this.s0 < 0) this.s0 += 1;
      this.s1 -= mash(seed);
      if (this.s1 < 0) this.s1 += 1;
      this.s2 -= mash(seed);
      if (this.s2 < 0) this.s2 += 1;
    }

    next() {
      const t = 2091639 * this.s0 + this.c * 2.3283064365386963e-10;
      this.s0 = this.s1;
      this.s1 = this.s2;
      return (this.s2 = t - (this.c = t | 0));
    }

    set state(st) {
      this.c = st.c;
      this.s0 = st.s0;
      this.s1 = st.s1;
      this.s2 = st.s2;
    }

    get state() {
      return { c: this.c, s0: this.s0, s1: this.s1, s2: this.s2 };
    }
  }

  function Mash() {
    let n = 4022871197;
    return function (data) {
      data = String(data);
      for (let i = 0; i < data.length; i++) {
        n += data.charCodeAt(i);
        let h = 0.02519603282416938 * n;
        n = h >>> 0;
        h -= n;
        h *= n;
        n = h >>> 0;
        h -= n;
        n += h * 4294967296;
      }
      return (n >>> 0) * 2.3283064365386963e-10;
    };
  }

  function createRandomGenerator(seed) {
    const gen = new AleaPRNG(seed);
    const rng = () => gen.next();
    rng.int32 = () => (gen.next() * 4294967296) | 0;
    rng.double = () => rng() + (((rng() * 2097152) | 0) * 1.1102230246251565e-16);
    rng.state = () => gen.state;
    rng.importState = (st) => {
      gen.state = st;
      return rng;
    };
    return rng;
  }

  // --- Core Algorithm Math ---
  const DECAY = -0.5;
  const FACTOR = 19 / 81;

  function forgettingCurve(elapsedDays, stability) {
    return +Math.pow(1 + (FACTOR * elapsedDays) / stability, DECAY).toFixed(8);
  }

  class FSRSAlgorithm {
    constructor(params) {
      setField(this, "param");
      setField(this, "intervalModifier");
      setField(this, "_seed");
      setField(this, "forgetting_curve", forgettingCurve);

      this.param = new Proxy(generatorParameters(params), this.params_handler_proxy());
      this.intervalModifier = this.calculate_interval_modifier(this.param.request_retention);
    }

    get interval_modifier() {
      return this.intervalModifier;
    }

    set seed(val) {
      this._seed = val;
    }

    calculate_interval_modifier(retention) {
      if (retention <= 0 || retention > 1) {
        throw new Error("Requested retention rate should be in the range (0,1]");
      }
      return +((Math.pow(retention, 1 / DECAY) - 1) / FACTOR).toFixed(8);
    }

    get parameters() {
      return this.param;
    }

    set parameters(val) {
      this.update_parameters(val);
    }

    params_handler_proxy() {
      const self = this;
      return {
        set: function (obj, prop, val) {
          if (prop === "request_retention" && Number.isFinite(val)) {
            self.intervalModifier = self.calculate_interval_modifier(Number(val));
          }
          return Reflect.set(obj, prop, val);
        },
      };
    }

    update_parameters(newParams) {
      const parsed = generatorParameters(newParams);
      for (const k in parsed) {
        if (k in this.param) {
          this.param[k] = parsed[k];
        }
      }
    }

    init_stability(rating) {
      return Math.max(this.param.w[rating - 1], 0.1);
    }

    init_difficulty(rating) {
      return this.constrain_difficulty(
        this.param.w[4] - Math.exp((rating - 1) * this.param.w[5]) + 1
      );
    }

    apply_fuzz(ivl, elapsedDays) {
      if (!this.param.enable_fuzz || ivl < 2.5) return Math.round(ivl);
      const rand = createRandomGenerator(this._seed)();
      const { min_ivl, max_ivl } = getFuzzRange(ivl, elapsedDays, this.param.maximum_interval);
      return Math.floor(rand * (max_ivl - min_ivl + 1) + min_ivl);
    }

    next_interval(stability, elapsedDays) {
      const rawIvl = Math.min(
        Math.max(1, Math.round(stability * this.intervalModifier)),
        this.param.maximum_interval
      );
      return this.apply_fuzz(rawIvl, elapsedDays);
    }

    linear_damping(deltaD, currentD) {
      return +((deltaD * (10 - currentD)) / 9).toFixed(8);
    }

    next_difficulty(d, rating) {
      const deltaD = -this.param.w[6] * (rating - 3);
      const rawD = d + this.linear_damping(deltaD, d);
      return this.constrain_difficulty(
        this.mean_reversion(this.init_difficulty(Rating.Easy), rawD)
      );
    }

    constrain_difficulty(d) {
      return Math.min(Math.max(+d.toFixed(8), 1), 10);
    }

    mean_reversion(initD, currentD) {
      return +(this.param.w[7] * initD + (1 - this.param.w[7]) * currentD).toFixed(8);
    }

    next_recall_stability(d, s, retrievability, rating) {
      const hardPenalty = Rating.Hard === rating ? this.param.w[15] : 1;
      const easyBonus = Rating.Easy === rating ? this.param.w[16] : 1;
      return +clamp(
        s *
          (1 +
            Math.exp(this.param.w[8]) *
              (11 - d) *
              Math.pow(s, -this.param.w[9]) *
              (Math.exp((1 - retrievability) * this.param.w[10]) - 1) *
              hardPenalty *
              easyBonus),
        S_MIN,
        36500
      ).toFixed(8);
    }

    next_forget_stability(d, s, retrievability) {
      return +clamp(
        this.param.w[11] *
          Math.pow(d, -this.param.w[12]) *
          (Math.pow(s + 1, this.param.w[13]) - 1) *
          Math.exp((1 - retrievability) * this.param.w[14]),
        S_MIN,
        36500
      ).toFixed(8);
    }

    next_short_term_stability(s, rating) {
      return +clamp(
        s * Math.exp(this.param.w[17] * (rating - 3 + this.param.w[18])),
        S_MIN,
        36500
      ).toFixed(8);
    }

    next_state(memory, elapsedDays, rating) {
      const { difficulty: d, stability: s } = memory ?? { difficulty: 0, stability: 0 };
      if (elapsedDays < 0) throw new Error(`Invalid delta_t "${elapsedDays}"`);
      if (rating < 0 || rating > 4) throw new Error(`Invalid grade "${rating}"`);

      if (d === 0 && s === 0) {
        return {
          difficulty: this.init_difficulty(rating),
          stability: this.init_stability(rating),
        };
      }
      if (rating === 0) return { difficulty: d, stability: s };
      if (d < 1 || s < S_MIN) {
        throw new Error(`Invalid memory state { difficulty: ${d}, stability: ${s} }`);
      }

      const r = this.forgetting_curve(elapsedDays, s);
      const recallS = this.next_recall_stability(d, s, r, rating);
      const forgetS = this.next_forget_stability(d, s, r);
      const shortTermS = this.next_short_term_stability(s, rating);

      let nextS = recallS;
      if (rating === 1) {
        let [w17, w18] = [0, 0];
        if (this.param.enable_short_term) {
          w17 = this.param.w[17];
          w18 = this.param.w[18];
        }
        const decayedS = s / Math.exp(w17 * w18);
        nextS = clamp(+decayedS.toFixed(8), S_MIN, forgetS);
      }

      if (elapsedDays === 0 && this.param.enable_short_term) {
        nextS = shortTermS;
      }

      return {
        difficulty: this.next_difficulty(d, rating),
        stability: nextS,
      };
    }
  }

  function defaultInitSeedStrategy() {
    const timestamp = this.review_time.getTime();
    const reps = this.current.reps;
    const factor = this.current.difficulty * this.current.stability;
    return `${timestamp}_${reps}_${factor}`;
  }

  function genSeedStrategyWithCardId(idProp) {
    return function () {
      const idVal = Reflect.get(this.current, idProp) ?? 0;
      const reps = this.current.reps;
      return String(idVal + reps || 0);
    };
  }

  var StrategyMode = ((m) => {
    m.SCHEDULER = "Scheduler";
    m.SEED = "Seed";
    return m;
  })(StrategyMode || {});

  // --- Abstract Scheduler Base Class ---
  class AbstractScheduler {
    constructor(card, reviewTime, algorithm, options = { seed: defaultInitSeedStrategy }) {
      setField(this, "last");
      setField(this, "current");
      setField(this, "review_time");
      setField(this, "next", new Map());
      setField(this, "algorithm");
      setField(this, "initSeedStrategy");

      this.algorithm = algorithm;
      this.initSeedStrategy = options.seed.bind(this);
      this.last = TypeConvert.card(card);
      this.current = TypeConvert.card(card);
      this.review_time = TypeConvert.time(reviewTime);
      this.init();
    }

    init() {
      const { state, last_review } = this.current;
      let elapsedDays = 0;
      if (state !== State.New && last_review) {
        elapsedDays = dateDiffInDays(last_review, this.review_time);
      }
      this.current.last_review = this.review_time;
      this.current.elapsed_days = elapsedDays;
      this.current.reps += 1;
      this.algorithm.seed = this.initSeedStrategy();
    }

    preview() {
      return {
        [Rating.Again]: this.review(Rating.Again),
        [Rating.Hard]: this.review(Rating.Hard),
        [Rating.Good]: this.review(Rating.Good),
        [Rating.Easy]: this.review(Rating.Easy),
        [Symbol.iterator]: this.previewIterator.bind(this),
      };
    }

    *previewIterator() {
      for (const grade of GRADES) {
        yield this.review(grade);
      }
    }

    review(rating) {
      const { state } = this.last;
      let result;
      switch (state) {
        case State.New:
          result = this.newState(rating);
          break;
        case State.Learning:
        case State.Relearning:
          result = this.learningState(rating);
          break;
        case State.Review:
          result = this.reviewState(rating);
          break;
      }
      if (result) return result;
      throw new Error("Invalid grade");
    }

    buildLog(rating) {
      const { last_review, due, elapsed_days } = this.last;
      return {
        rating: rating,
        state: this.current.state,
        due: last_review || due,
        stability: this.current.stability,
        difficulty: this.current.difficulty,
        elapsed_days: this.current.elapsed_days,
        last_elapsed_days: elapsed_days,
        scheduled_days: this.current.scheduled_days,
        review: this.review_time,
      };
    }
  }

  // --- Scheduler with Short Term Enabled ---
  class ShortTermScheduler extends AbstractScheduler {
    newState(rating) {
      const cached = this.next.get(rating);
      if (cached) return cached;

      const card = TypeConvert.card(this.current);
      card.difficulty = this.algorithm.init_difficulty(rating);
      card.stability = this.algorithm.init_stability(rating);

      switch (rating) {
        case Rating.Again:
          card.scheduled_days = 0;
          card.due = this.review_time.scheduler(1);
          card.state = State.Learning;
          break;
        case Rating.Hard:
          card.scheduled_days = 0;
          card.due = this.review_time.scheduler(5);
          card.state = State.Learning;
          break;
        case Rating.Good:
          card.scheduled_days = 0;
          card.due = this.review_time.scheduler(10);
          card.state = State.Learning;
          break;
        case Rating.Easy: {
          const ivl = this.algorithm.next_interval(card.stability, this.current.elapsed_days);
          card.scheduled_days = ivl;
          card.due = this.review_time.scheduler(ivl, true);
          card.state = State.Review;
          break;
        }
        default:
          throw new Error("Invalid grade");
      }

      const item = { card, log: this.buildLog(rating) };
      this.next.set(rating, item);
      return item;
    }

    learningState(rating) {
      const cached = this.next.get(rating);
      if (cached) return cached;

      const { state, difficulty, stability } = this.last;
      const card = TypeConvert.card(this.current);
      const elapsed = this.current.elapsed_days;

      card.difficulty = this.algorithm.next_difficulty(difficulty, rating);
      card.stability = this.algorithm.next_short_term_stability(stability, rating);

      switch (rating) {
        case Rating.Again:
          card.scheduled_days = 0;
          card.due = this.review_time.scheduler(5, false);
          card.state = state;
          break;
        case Rating.Hard:
          card.scheduled_days = 0;
          card.due = this.review_time.scheduler(10);
          card.state = state;
          break;
        case Rating.Good: {
          const ivl = this.algorithm.next_interval(card.stability, elapsed);
          card.scheduled_days = ivl;
          card.due = this.review_time.scheduler(ivl, true);
          card.state = State.Review;
          break;
        }
        case Rating.Easy: {
          const goodStability = this.algorithm.next_short_term_stability(stability, Rating.Good);
          const goodIvl = this.algorithm.next_interval(goodStability, elapsed);
          const maxIvl = Math.max(this.algorithm.next_interval(card.stability, elapsed), goodIvl + 1);
          card.scheduled_days = maxIvl;
          card.due = this.review_time.scheduler(maxIvl, true);
          card.state = State.Review;
          break;
        }
        default:
          throw new Error("Invalid grade");
      }

      const item = { card, log: this.buildLog(rating) };
      this.next.set(rating, item);
      return item;
    }

    reviewState(rating) {
      const cached = this.next.get(rating);
      if (cached) return cached;

      const elapsed = this.current.elapsed_days;
      const { difficulty, stability } = this.last;
      const r = this.algorithm.forgetting_curve(elapsed, stability);

      const againCard = TypeConvert.card(this.current);
      const hardCard = TypeConvert.card(this.current);
      const goodCard = TypeConvert.card(this.current);
      const easyCard = TypeConvert.card(this.current);

      this.next_ds(againCard, hardCard, goodCard, easyCard, difficulty, stability, r);
      this.next_interval(againCard, hardCard, goodCard, easyCard, elapsed);
      this.next_state(againCard, hardCard, goodCard, easyCard);

      againCard.lapses += 1;

      this.next.set(Rating.Again, { card: againCard, log: this.buildLog(Rating.Again) });
      this.next.set(Rating.Hard, { card: hardCard, log: super.buildLog(Rating.Hard) });
      this.next.set(Rating.Good, { card: goodCard, log: super.buildLog(Rating.Good) });
      this.next.set(Rating.Easy, { card: easyCard, log: super.buildLog(Rating.Easy) });

      return this.next.get(rating);
    }

    next_ds(again, hard, good, easy, d, s, retrievability) {
      again.difficulty = this.algorithm.next_difficulty(s, Rating.Again);
      const decayedS =
        retrievability /
        Math.exp(this.algorithm.parameters.w[17] * this.algorithm.parameters.w[18]);
      const forgetS = this.algorithm.next_forget_stability(s, retrievability, d);
      again.stability = clamp(+decayedS.toFixed(8), S_MIN, forgetS);

      hard.difficulty = this.algorithm.next_difficulty(s, Rating.Hard);
      hard.stability = this.algorithm.next_recall_stability(s, retrievability, d, Rating.Hard);

      good.difficulty = this.algorithm.next_difficulty(s, Rating.Good);
      good.stability = this.algorithm.next_recall_stability(s, retrievability, d, Rating.Good);

      easy.difficulty = this.algorithm.next_difficulty(s, Rating.Easy);
      easy.stability = this.algorithm.next_recall_stability(s, retrievability, d, Rating.Easy);
    }

    next_interval(again, hard, good, easy, elapsed) {
      let hardIvl = this.algorithm.next_interval(hard.stability, elapsed);
      let goodIvl = this.algorithm.next_interval(good.stability, elapsed);
      hardIvl = Math.min(hardIvl, goodIvl);
      goodIvl = Math.max(goodIvl, hardIvl + 1);

      const easyIvl = Math.max(this.algorithm.next_interval(easy.stability, elapsed), goodIvl + 1);

      again.scheduled_days = 0;
      again.due = this.review_time.scheduler(5);

      hard.scheduled_days = hardIvl;
      hard.due = this.review_time.scheduler(hardIvl, true);

      good.scheduled_days = goodIvl;
      good.due = this.review_time.scheduler(goodIvl, true);

      easy.scheduled_days = easyIvl;
      easy.due = this.review_time.scheduler(easyIvl, true);
    }

    next_state(again, hard, good, easy) {
      again.state = State.Relearning;
      hard.state = State.Review;
      good.state = State.Review;
      easy.state = State.Review;
    }
  }

  // --- Scheduler without Short Term (Traditional) ---
  class LongTermScheduler extends AbstractScheduler {
    newState(rating) {
      const cached = this.next.get(rating);
      if (cached) return cached;

      this.current.scheduled_days = 0;
      this.current.elapsed_days = 0;

      const againCard = TypeConvert.card(this.current);
      const hardCard = TypeConvert.card(this.current);
      const goodCard = TypeConvert.card(this.current);
      const easyCard = TypeConvert.card(this.current);

      this.init_ds(againCard, hardCard, goodCard, easyCard);
      this.next_interval(againCard, hardCard, goodCard, easyCard, 0);
      this.next_state(againCard, hardCard, goodCard, easyCard);
      this.update_next(againCard, hardCard, goodCard, easyCard);

      return this.next.get(rating);
    }

    init_ds(again, hard, good, easy) {
      again.difficulty = this.algorithm.init_difficulty(Rating.Again);
      again.stability = this.algorithm.init_stability(Rating.Again);

      hard.difficulty = this.algorithm.init_difficulty(Rating.Hard);
      hard.stability = this.algorithm.init_stability(Rating.Hard);

      good.difficulty = this.algorithm.init_difficulty(Rating.Good);
      good.stability = this.algorithm.init_stability(Rating.Good);

      easy.difficulty = this.algorithm.init_difficulty(Rating.Easy);
      easy.stability = this.algorithm.init_stability(Rating.Easy);
    }

    learningState(rating) {
      return this.reviewState(rating);
    }

    reviewState(rating) {
      const cached = this.next.get(rating);
      if (cached) return cached;

      const elapsed = this.current.elapsed_days;
      const { difficulty, stability } = this.last;
      const r = this.algorithm.forgetting_curve(elapsed, stability);

      const againCard = TypeConvert.card(this.current);
      const hardCard = TypeConvert.card(this.current);
      const goodCard = TypeConvert.card(this.current);
      const easyCard = TypeConvert.card(this.current);

      this.next_ds(againCard, hardCard, goodCard, easyCard, difficulty, stability, r);
      this.next_interval(againCard, hardCard, goodCard, easyCard, elapsed);
      this.next_state(againCard, hardCard, goodCard, easyCard);

      againCard.lapses += 1;
      this.update_next(againCard, hardCard, goodCard, easyCard);

      return this.next.get(rating);
    }

    next_ds(again, hard, good, easy, d, s, retrievability) {
      again.difficulty = this.algorithm.next_difficulty(s, Rating.Again);
      const forgetS = this.algorithm.next_forget_stability(s, retrievability, d);
      again.stability = clamp(retrievability, S_MIN, forgetS);

      hard.difficulty = this.algorithm.next_difficulty(s, Rating.Hard);
      hard.stability = this.algorithm.next_recall_stability(s, retrievability, d, Rating.Hard);

      good.difficulty = this.algorithm.next_difficulty(s, Rating.Good);
      good.stability = this.algorithm.next_recall_stability(s, retrievability, d, Rating.Good);

      easy.difficulty = this.algorithm.next_difficulty(s, Rating.Easy);
      easy.stability = this.algorithm.next_recall_stability(s, retrievability, d, Rating.Easy);
    }

    next_interval(again, hard, good, easy, elapsed) {
      let againIvl = this.algorithm.next_interval(again.stability, elapsed);
      let hardIvl = this.algorithm.next_interval(hard.stability, elapsed);
      let goodIvl = this.algorithm.next_interval(good.stability, elapsed);
      let easyIvl = this.algorithm.next_interval(easy.stability, elapsed);

      hardIvl = Math.min(hardIvl, goodIvl);
      goodIvl = Math.max(goodIvl, hardIvl + 1);
      easyIvl = Math.max(easyIvl, goodIvl + 1);
      againIvl = Math.min(againIvl, hardIvl);

      again.scheduled_days = againIvl;
      again.due = this.review_time.scheduler(againIvl, true);

      hard.scheduled_days = hardIvl;
      hard.due = this.review_time.scheduler(hardIvl, true);

      good.scheduled_days = goodIvl;
      good.due = this.review_time.scheduler(goodIvl, true);

      easy.scheduled_days = easyIvl;
      easy.due = this.review_time.scheduler(easyIvl, true);
    }

    next_state(again, hard, good, easy) {
      again.state = State.Review;
      hard.state = State.Review;
      good.state = State.Review;
      easy.state = State.Review;
    }

    update_next(again, hard, good, easy) {
      this.next.set(Rating.Again, { card: again, log: this.buildLog(Rating.Again) });
      this.next.set(Rating.Hard, { card: hard, log: super.buildLog(Rating.Hard) });
      this.next.set(Rating.Good, { card: good, log: super.buildLog(Rating.Good) });
      this.next.set(Rating.Easy, { card: easy, log: super.buildLog(Rating.Easy) });
    }
  }

  // --- Rescheduler & History Replayer ---
  class Rescheduler {
    constructor(fsrsInstance) {
      setField(this, "fsrs", fsrsInstance);
    }

    replay(card, reviewTime, rating) {
      return this.fsrs.next(card, reviewTime, rating);
    }

    handleManualRating(card, state, reviewTime, elapsedDays, stability, difficulty, dueDate) {
      if (typeof state === "undefined") {
        throw new Error("reschedule: state is required for manual rating");
      }

      let log, newCard;
      if (state === State.New) {
        log = {
          rating: Rating.Manual,
          state: state,
          due: dueDate ?? reviewTime,
          stability: card.stability,
          difficulty: card.difficulty,
          elapsed_days: elapsedDays,
          last_elapsed_days: card.elapsed_days,
          scheduled_days: card.scheduled_days,
          review: reviewTime,
        };
        newCard = createEmptyCard(reviewTime);
        newCard.last_review = reviewTime;
      } else {
        if (typeof dueDate === "undefined") {
          throw new Error("reschedule: due is required for manual rating");
        }
        const scheduledDays = dueDate.diff(reviewTime, "days");
        log = {
          rating: Rating.Manual,
          state: card.state,
          due: card.last_review || card.due,
          stability: card.stability,
          difficulty: card.difficulty,
          elapsed_days: elapsedDays,
          last_elapsed_days: card.elapsed_days,
          scheduled_days: card.scheduled_days,
          review: reviewTime,
        };
        newCard = merge(assignProps({}, card), {
          state: state,
          due: dueDate,
          last_review: reviewTime,
          stability: stability || card.stability,
          difficulty: difficulty || card.difficulty,
          elapsed_days: elapsedDays,
          scheduled_days: scheduledDays,
          reps: card.reps + 1,
        });
      }
      return { card: newCard, log: log };
    }

    reschedule(card, history) {
      const records = [];
      let currentCard = createEmptyCard(card.due);

      for (const item of history) {
        let result;
        item.review = TypeConvert.time(item.review);

        if (item.rating === Rating.Manual) {
          let elapsedDays = 0;
          if (currentCard.state !== State.New && currentCard.last_review) {
            elapsedDays = item.review.diff(currentCard.last_review, "days");
          }
          result = this.handleManualRating(
            currentCard,
            item.state,
            item.review,
            elapsedDays,
            item.stability,
            item.difficulty,
            item.due ? TypeConvert.time(item.due) : undefined
          );
        } else {
          result = this.replay(currentCard, item.review, item.rating);
        }

        records.push(result);
        currentCard = result.card;
      }
      return records;
    }

    calculateManualRecord(card, reviewTime, lastRecord, updateMemoryState) {
      if (!lastRecord) return null;
      const { card: lastCard, log: lastLog } = lastRecord;
      const convertedCard = TypeConvert.card(card);

      if (convertedCard.due.getTime() === lastCard.due.getTime()) return null;

      convertedCard.scheduled_days = lastCard.due.diff(convertedCard.due, "days");
      return this.handleManualRating(
        convertedCard,
        lastCard.state,
        TypeConvert.time(reviewTime),
        lastLog.elapsed_days,
        updateMemoryState ? lastCard.stability : undefined,
        updateMemoryState ? lastCard.difficulty : undefined,
        lastCard.due
      );
    }
  }

  // --- Main FSRS Controller Class ---
  class FSRS extends FSRSAlgorithm {
    constructor(params) {
      super(params);
      setField(this, "strategyHandler", new Map());
      setField(this, "Scheduler");

      const { enable_short_term } = this.parameters;
      this.Scheduler = enable_short_term ? ShortTermScheduler : LongTermScheduler;
    }

    params_handler_proxy() {
      const self = this;
      return {
        set: function (obj, prop, val) {
          if (prop === "request_retention" && Number.isFinite(val)) {
            self.intervalModifier = self.calculate_interval_modifier(Number(val));
          } else if (prop === "enable_short_term") {
            self.Scheduler = val === true ? ShortTermScheduler : LongTermScheduler;
          }
          return Reflect.set(obj, prop, val);
        },
      };
    }

    useStrategy(key, strategy) {
      this.strategyHandler.set(key, strategy);
      return this;
    }

    clearStrategy(key) {
      if (key) this.strategyHandler.delete(key);
      else this.strategyHandler.clear();
      return this;
    }

    getScheduler(card, reviewTime) {
      const seedStrategy = this.strategyHandler.get(StrategyMode.SEED);
      const schedulerStrategy =
        this.strategyHandler.get(StrategyMode.SCHEDULER) || this.Scheduler;
      return new schedulerStrategy(card, reviewTime, this, {
        seed: seedStrategy || defaultInitSeedStrategy,
      });
    }

    repeat(card, reviewTime, callback) {
      const schedule = this.getScheduler(card, reviewTime).preview();
      return callback && typeof callback === "function" ? callback(schedule) : schedule;
    }

    next(card, reviewTime, rating, callback) {
      const scheduler = this.getScheduler(card, reviewTime);
      const parsedRating = TypeConvert.rating(rating);
      if (parsedRating === Rating.Manual) {
        throw new Error("Cannot review a manual rating");
      }
      const result = scheduler.review(parsedRating);
      return callback && typeof callback === "function" ? callback(result) : result;
    }

    get_retrievability(card, reviewTime, formatPercentage = true) {
      const c = TypeConvert.card(card);
      const now = reviewTime ? TypeConvert.time(reviewTime) : new Date();
      const elapsed =
        c.state !== State.New ? Math.max(now.diff(c.last_review, "days"), 0) : 0;
      const r =
        c.state !== State.New
          ? this.forgetting_curve(elapsed, +c.stability.toFixed(8))
          : 0;

      return formatPercentage ? `${(r * 100).toFixed(2)}%` : r;
    }

    rollback(card, log, callback) {
      const c = TypeConvert.card(card);
      const l = TypeConvert.review_log(log);
      if (l.rating === Rating.Manual) {
        throw new Error("Cannot rollback a manual rating");
      }

      let due, lastReview, lapses;
      switch (l.state) {
        case State.New:
          due = l.due;
          lastReview = undefined;
          lapses = 0;
          break;
        case State.Learning:
        case State.Relearning:
        case State.Review:
          due = l.review;
          lastReview = l.due;
          lapses =
            c.lapses - (l.rating === Rating.Again && l.state === State.Review ? 1 : 0);
          break;
      }

      const rolledCard = merge(assignProps({}, c), {
        due: due,
        stability: l.stability,
        difficulty: l.difficulty,
        elapsed_days: l.last_elapsed_days,
        scheduled_days: l.scheduled_days,
        reps: Math.max(0, c.reps - 1),
        lapses: Math.max(0, lapses),
        state: l.state,
        last_review: lastReview,
      });

      return callback && typeof callback === "function" ? callback(rolledCard) : rolledCard;
    }

    forget(card, reviewTime, resetReps = false, callback) {
      const c = TypeConvert.card(card);
      const now = TypeConvert.time(reviewTime);
      const elapsed = c.state === State.New ? 0 : now.diff(c.last_review, "days");

      const log = {
        rating: Rating.Manual,
        state: c.state,
        due: c.due,
        stability: c.stability,
        difficulty: c.difficulty,
        elapsed_days: 0,
        last_elapsed_days: c.elapsed_days,
        scheduled_days: elapsed,
        review: now,
      };

      const result = {
        card: merge(assignProps({}, c), {
          due: now,
          stability: 0,
          difficulty: 0,
          elapsed_days: 0,
          scheduled_days: 0,
          reps: resetReps ? 0 : c.reps,
          lapses: resetReps ? 0 : c.lapses,
          state: State.New,
          last_review: c.last_review,
        }),
        log: log,
      };

      return callback && typeof callback === "function" ? callback(result) : result;
    }

    reschedule(card, history = [], options = {}) {
      const {
        recordLogHandler,
        reviewsOrderBy,
        skipManual = true,
        now = new Date(),
        update_memory_state = false,
      } = options;

      if (reviewsOrderBy && typeof reviewsOrderBy === "function") {
        history.sort(reviewsOrderBy);
      }
      if (skipManual) {
        history = history.filter((item) => item.rating !== Rating.Manual);
      }

      const rescheduler = new Rescheduler(this);
      const collections = rescheduler.reschedule(options.first_card || createEmptyCard(), history);
      const len = collections.length;
      const originalCard = TypeConvert.card(card);
      const rescheduleItem = rescheduler.calculateManualRecord(
        originalCard,
        now,
        len ? collections[len - 1] : undefined,
        update_memory_state
      );

      if (recordLogHandler && typeof recordLogHandler === "function") {
        return {
          collections: collections.map(recordLogHandler),
          reschedule_item: rescheduleItem ? recordLogHandler(rescheduleItem) : null,
        };
      }

      return {
        collections: collections,
        reschedule_item: rescheduleItem,
      };
    }
  }

  // --- Export Factory Function ---
  const createFSRS = (params) => new FSRS(params || {});

  // Bind All Public Exports
  exports.AbstractScheduler = AbstractScheduler;
  exports.CLAMP_PARAMETERS = CLAMP_PARAMETERS;
  exports.DECAY = DECAY;
  exports.DefaultInitSeedStrategy = defaultInitSeedStrategy;
  exports.FACTOR = FACTOR;
  exports.FSRS = FSRS;
  exports.FSRSAlgorithm = FSRSAlgorithm;
  exports.FSRSVersion = FULL_VERSION_STR;
  exports.GenSeedStrategyWithCardId = genSeedStrategyWithCardId;
  exports.Grades = GRADES;
  exports.INIT_S_MAX = INIT_S_MAX;
  exports.Rating = Rating;
  exports.S_MIN = S_MIN;
  exports.State = State;
  exports.StrategyMode = StrategyMode;
  exports.TypeConvert = TypeConvert;
  exports.clamp = clamp;
  exports.createEmptyCard = createEmptyCard;
  exports.dateDiffInDays = dateDiffInDays;
  exports.date_diff = dateDiff;
  exports.date_scheduler = dateScheduler;
  exports.default_enable_fuzz = DEFAULT_ENABLE_FUZZ;
  exports.default_enable_short_term = DEFAULT_ENABLE_SHORT_TERM;
  exports.default_maximum_interval = DEFAULT_MAX_INTERVAL;
  exports.default_request_retention = DEFAULT_REQUEST_RETENTION;
  exports.default_w = DEFAULT_WEIGHTS;
  exports.fixDate = fixDate;
  exports.fixRating = fixRating;
  exports.fixState = fixState;
  exports.forgetting_curve = forgettingCurve;
  exports.formatDate = formatDate;
  exports.fsrs = createFSRS;
  exports.generatorParameters = generatorParameters;
  exports.get_fuzz_range = getFuzzRange;
  exports.show_diff_message = showDiffMessage;
});
