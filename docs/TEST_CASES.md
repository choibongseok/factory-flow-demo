# 테스트 케이스

모든 행은 실제 테스트 함수 하나와 1:1 로 대응합니다. 행 수와 테스트 수는 `make verify` 가 `scripts/check-test-cases.py` 로 대조합니다.
(통합 테스트는 Docker 가 필요해서 `make test-integration` 으로 따로 돌립니다.)

| 묶음 | 개수 | 실행 |
|---|---|---|
| API (pytest, 정규화·멱등·지표·상태·REST·WebSocket) | 46 | `make test-api` |
| 시뮬레이터 (pytest) | 4 | `make test-sim` |
| 게이트웨이 (pytest, OPC-UA -> MQTT 변환) | 7 | `make test-gateway` |
| 웹 단위 (node:test, 지표 엔진·시뮬레이터·데이터 출처·토폴로지) | 31 | `make test-web` |
| E2E (Playwright, 브라우저) | 13 | `make test-e2e` |
| 실스택 통합 (실제 Mosquitto + PostgreSQL) | 6 | `make test-integration` (Docker 필요) |
| **합계** | **107** | `make verify` 는 통합을 제외한 101건 |

| ID | 영역 | 시나리오 | 입력/조건 | 기대 결과 | 자동화 테스트(파일::함수) | 종류 |
|---|---|---|---|---|---|---|
| API-001 | API/정규화 | 위치 이벤트 정상 파싱 | topic `factory/line-a/amr-01/position`, x=1, y=2.5, event_id=e1 | line/device/type/event_id 분해, x,y 실수로 정규화, ts UTC | `api/tests/test_normalize.py::test_position_ok` | unit |
| API-002 | API/정규화 | RFID 태그 읽기 파싱 | tag_id, sku, direction=in, qty 생략 | qty 기본값 1, direction 유지 | `api/tests/test_normalize.py::test_tag_read_ok` | unit |
| API-003 | API/정규화 | 잘못된 토픽 거부 | 세그먼트 수 부족, 루트가 factory 아님, 빈 세그먼트, 세그먼트 초과 | 모두 `bad topic` ValueError | `api/tests/test_normalize.py::test_bad_topic` | unit |
| API-004 | API/정규화 | 지원하지 않는 이벤트 종류 거부 | topic 끝이 `explode` | `unsupported` ValueError | `api/tests/test_normalize.py::test_unknown_type` | unit |
| API-005 | API/정규화 | JSON 이 아닌 페이로드 거부 | 문자열, 배열, 잘못된 UTF-8 바이트 | 모두 ValueError | `api/tests/test_normalize.py::test_bad_payload` | unit |
| API-006 | API/정규화 | 스키마 위반 거부 | tag_read 의 direction=sideways | `invalid tag_read payload` ValueError | `api/tests/test_normalize.py::test_schema_violation` | unit |
| API-007 | API/정규화 | event_id 길이 제한 | event_id 65자 | `event_id` ValueError | `api/tests/test_normalize.py::test_event_id_too_long` | unit |
| API-008 | API/정규화 | event_id 없는 장비의 파생 ID | 같은 topic+본문(키 순서만 다름), 값이 다른 본문 | 같은 내용은 같은 ID, 다른 내용은 다른 ID | `api/tests/test_normalize.py::test_derived_id_is_deterministic_and_content_sensitive` | unit |
| API-009 | API/정규화 | 타임스탬프 해석 | epoch 0, 해석 불가 문자열, None, +09:00 ISO | epoch 는 1970 UTC, 불가·None 은 도착 시각, +09:00 은 UTC 로 환산 | `api/tests/test_normalize.py::test_parse_ts_variants` | unit |
| API-010 | API/멱등 저장 | 같은 event_id 두 번 수신 | 동일 위치 이벤트 2회 | 1회만 저장, stored=1 duplicates=1 | `api/tests/test_pipeline.py::test_duplicate_event_id_is_ignored` | unit |
| API-011 | API/멱등 저장 | 중복 태그 읽기가 재고를 부풀리지 않음 | 같은 tag_read 3회 | 입고 수량 1 | `api/tests/test_pipeline.py::test_duplicate_tag_read_counts_once` | unit |
| API-012 | API/멱등 저장 | 중복은 WebSocket 으로 푸시하지 않음 | 같은 status 2회, 허브 가로채기 | 푸시 1회 | `api/tests/test_pipeline.py::test_duplicate_is_not_broadcast` | unit |
| API-013 | API/멱등 저장 | 깨진 메시지는 예외 없이 거부 집계 | 잘못된 토픽, JSON 아님 | handle 이 False, rejected=2 stored=0 | `api/tests/test_pipeline.py::test_rejected_messages_are_counted_not_raised` | unit |
| API-014 | API/멱등 저장 | 순서 역전 이벤트가 최신 상태를 덮지 않음 | ts 가 더 오래된 위치 이벤트가 나중에 도착 | 장비 위치는 최신값 유지, 이벤트 로그에는 2건 | `api/tests/test_pipeline.py::test_out_of_order_event_does_not_overwrite_newer_state` | unit |
| API-015 | API/장비 상태 | 장비 종류 추정과 상태 반영 | amr status/gate tag_read/scanner scan | kind=amr/rfid_gate/qr_scanner, 상태·배터리 반영, 모두 online | `api/tests/test_pipeline.py::test_device_state_and_kind` | unit |
| API-016 | API/입출고 | SKU별 입출고 집계와 라인 필터 | line-a/line-b 혼합 tag_read 5건 | SKU별 입고·출고·순증감 합산, 라인 필터 시 해당 라인만 | `api/tests/test_pipeline.py::test_inventory_aggregation_and_line_filter` | unit |
| API-017 | API/게이트웨이 호환 | 기계 시퀀스 기반 ID 의 재시작 후 재수신 | `opcua-scanner-opcua-01-5` 를 시각만 바꿔 2회 | 1건만 저장 | `api/tests/test_pipeline.py::test_gateway_style_event_ids_dedupe_across_restart` | unit |
| API-018 | API/지표 | 저장·중복·거부가 지표에 기록됨 | tag_read 1회 + 중복 + 쓰레기, 이벤트 ts 가 50ms 전 | stored=1 duplicates=1 rejected=1 in=3, p95>=50ms | `api/tests/test_pipeline.py::test_pipeline_feeds_metrics_for_stored_duplicate_and_rejected` | unit |
| API-019 | API/보관 | 보관 기간이 지난 이벤트 정리 | 3시간 전 이벤트와 1분 전 이벤트, 보관 1시간 | 오래된 1건만 삭제, 입출고 집계도 함께 감소 | `api/tests/test_pipeline.py::test_purge_removes_only_events_older_than_retention` | unit |
| API-020 | API/REST | 장비·이벤트·입출고·내역·health 조회 | 위치·상태·태그 이벤트(중복 1건 포함) 투입 후 각 엔드포인트 호출 | 장비 좌표·상태 반영, 필터 동작, limit=0 은 422, health 의 stored=3 duplicates=1 | `api/tests/test_api.py::test_rest_endpoints` | integration |
| API-021 | API/WebSocket | 접속 시 스냅샷 후 실시간 이벤트 | 연결 후 새 이벤트, 이어서 같은 ID 중복, 새 ID | snapshot -> event 푸시, 중복은 푸시 없음 | `api/tests/test_api.py::test_websocket_snapshot_then_live_event` | integration |
| API-022 | API/지표 | /api/metrics 응답과 파라미터 검증 | seconds=60 step=5, 중복 1건 포함, line=line-b, seconds=1, step=0 | summary 값과 dup_rate 0.5, 다른 라인은 0건, 범위 밖 값은 422 | `api/tests/test_api.py::test_metrics_endpoint_reports_traffic_and_validates_params` | integration |
| API-023 | API/상태 | /api/status 즉시 응답과 starting 판정 | 브로커 미연결·이벤트 없음 | `Cache-Control: no-store`, state=starting, mqtt/simulator=pending, last_event_age_s=null | `api/tests/test_api.py::test_status_answers_immediately_and_reports_starting_without_data` | integration |
| API-024 | API/상태 | DB 준비 전에도 /api/status 응답 | startup_wait_seconds=0 | 200 으로 즉시 응답 | `api/tests/test_api.py::test_status_is_available_before_database_is_ready` | integration |
| API-025 | API/상태 | 브로커 연결 + 이벤트 유입 시 ready | mqtt=ok 후 status 이벤트 투입 | state=ready, simulator=running, last_event_age_s<5 | `api/tests/test_api.py::test_status_ready_after_broker_connected_and_events_flow` | integration |
| API-026 | API/보안 | WebSocket origin 검사 | CORS 목록 `https://example.github.io`, 다른 origin 으로 접속 | 허용되지 않은 origin 은 1008 로 종료, 허용 origin 은 snapshot 수신 | `api/tests/test_api.py::test_websocket_rejects_origin_not_in_cors_list` | integration |
| API-027 | API/설정 | 호스팅 Postgres URL 변환 | `postgresql://…?sslmode=require&channel_binding=require` | `postgresql+asyncpg://…?ssl=require`, channel_binding 제거 | `api/tests/test_config.py::test_hosted_postgres_url_is_converted_for_asyncpg` | unit |
| API-028 | API/설정 | scheme 별칭과 변환 불필요 URL | `postgres://`, 이미 asyncpg 형식, sqlite | 별칭만 변환, 나머지는 그대로 | `api/tests/test_config.py::test_postgres_scheme_alias_and_already_converted_urls` | unit |
| API-029 | API/설정 | 환경변수로 받은 URL 도 변환 | DATABASE_URL 환경변수 | Settings 가 변환된 URL 보유 | `api/tests/test_config.py::test_settings_normalizes_database_url_from_environment` | unit |
| API-030 | API/지표 | 백분위는 nearest-rank | 1..100, 빈 목록, 단일 값, 순서 뒤섞인 입력 | p50=50 p95=95 p100=100, 빈 목록은 None, 입력 순서 무관 | `api/tests/test_metrics.py::test_percentile_nearest_rank` | unit |
| API-031 | API/지표 | 1초 버킷 경계 | 100.999 와 101.0 초의 이벤트 | 서로 다른 버킷 | `api/tests/test_metrics.py::test_bucket_boundary_one_second` | unit |
| API-032 | API/지표 | 5초 버킷 경계 | 104.9 와 105.0 초의 이벤트 | 100 버킷과 105 버킷으로 분리 | `api/tests/test_metrics.py::test_bucket_boundary_five_second_step` | unit |
| API-033 | API/지표 | 중복률과 수신 합계 | 저장 3, 중복 1, 거부 1 | received=5, dup_rate=0.2 | `api/tests/test_metrics.py::test_duplicate_rate_and_received_total` | unit |
| API-034 | API/지표 | 라인 필터 | line-a 만 조회 | 다른 라인과 거부 건 제외, 전체 조회는 4건 | `api/tests/test_metrics.py::test_line_filter_excludes_other_lines_and_rejected` | unit |
| API-035 | API/지표 | 요약 지연은 전체 표본의 백분위 | 지연 1..100ms 를 여러 버킷에 분산 | p50=50 p95=95 (버킷 평균이 아님) | `api/tests/test_metrics.py::test_summary_latency_percentiles_merge_all_buckets` | unit |
| API-036 | API/지표 | 빈 구간 | 데이터 없는 10초 | 10개 버킷, p95=null, per_second=0 | `api/tests/test_metrics.py::test_empty_buckets_have_null_latency_and_zero_counts` | unit |
| API-037 | API/지표 | 라인별 입출고 수량 | line-a in5/out2, line-b in1 | 요약 in=6 out=2, 버킷의 라인별 값 일치 | `api/tests/test_metrics.py::test_tag_read_quantities_per_line` | unit |
| API-038 | API/지표 | 보관 기간 밖 버킷 정리 | 보관 60초, 200초 뒤 기록 | 오래된 버킷 삭제 | `api/tests/test_metrics.py::test_old_buckets_are_pruned_after_retention` | unit |
| API-039 | API/지표 | 초당 처리량은 경과 구간 기준 | 300초 창에 10초치 이벤트 | per_second=1.0 | `api/tests/test_metrics.py::test_per_second_uses_elapsed_span_not_window` | unit |
| API-040 | API/지표 | 시리즈 지연은 5초 이동 창 | 100초에 900ms 1건, 이후 매초 10ms | 100~104초 버킷 p95=900, 105초부터 10 (1초짜리 바늘 없음), 첫 표본 이전은 null | `api/tests/test_metrics.py::test_series_latency_uses_a_five_second_moving_window` | unit |
| API-041 | API/상태 | 모두 pending 이면 starting | 초기 상태 | state=starting | `api/tests/test_status.py::test_all_pending_is_starting` | unit |
| API-042 | API/상태 | DB ok, MQTT pending 이면 starting | db=ok | state=starting | `api/tests/test_status.py::test_db_ok_mqtt_pending_is_starting` | unit |
| API-043 | API/상태 | error 가 하나라도 있으면 degraded | mqtt=error, 나머지 pending | state=degraded | `api/tests/test_status.py::test_any_error_is_degraded_even_if_others_pending` | unit |
| API-044 | API/상태 | ready 조건 | db·mqtt ok, 이벤트 없음 -> 이벤트 3초 전 | 이벤트 전에는 starting, 후에는 ready 와 ingest(age 3.0, 38.0/s) | `api/tests/test_status.py::test_ready_needs_db_mqtt_and_a_recent_event` | unit |
| API-045 | API/상태 | 이벤트가 오래되면 simulator stopped | 마지막 이벤트 11초 전 | simulator=stopped, state=degraded | `api/tests/test_status.py::test_stale_events_mean_simulator_stopped_and_degraded` | unit |
| API-046 | API/상태 | uptime 계산 | 시작 12.9초 후 | uptime_s=12 | `api/tests/test_status.py::test_uptime_counts_seconds_since_start` | unit |
| SIM-001 | 시뮬레이터 | 메시지 봉투와 QoS | position/tag_read 메시지 생성 | topic 규약, event_id 32자, ts 존재, position QoS0, tag_read QoS1 | `simulator/tests/test_sim.py::test_envelope_and_qos` | unit |
| SIM-002 | 시뮬레이터 | 이벤트 ID 유일성 | 500개 생성 | 모두 다름 | `simulator/tests/test_sim.py::test_event_ids_unique` | unit |
| SIM-003 | 시뮬레이터 | 장비가 지도 범위 안에서 모든 이벤트 종류를 냄 | 2라인 x AMR2대, 600틱 | 좌표는 0..100 x 0..60, position/status/tag_read/scan 모두 발생 | `simulator/tests/test_sim.py::test_fleet_stays_on_map_and_emits_all_event_types` | unit |
| SIM-004 | 시뮬레이터 | 시드 재현성 | 같은 seed 로 두 번 실행 | 위치 시퀀스 동일 | `simulator/tests/test_sim.py::test_seed_is_reproducible` | unit |
| GW-001 | 게이트웨이 | 스캔·상태 토픽 규약 | 새 시퀀스 번호 1건 | `factory/line-a/<device>/scan` 과 `/status` 두 메시지, QoS1 | `gateway/tests/test_convert.py::test_scan_and_status_use_shared_topic_convention` | unit |
| GW-002 | 게이트웨이 | 스캔 페이로드 | code=QR-777777, ok | code·result·ts 포함 | `gateway/tests/test_convert.py::test_scan_payload_carries_code_result_and_timestamp` | unit |
| GW-003 | 게이트웨이 | 시퀀스 기반 event_id | seq=5 | `opcua-<device>-5`, `opcua-<device>-status-5` | `gateway/tests/test_convert.py::test_event_id_is_derived_from_machine_sequence_number` | unit |
| GW-004 | 게이트웨이 | 실패 스캔과 정지 상태 매핑 | ok=False, running=False | result=fail, state=idle | `gateway/tests/test_convert.py::test_failed_scan_maps_to_fail_and_stopped_machine_to_idle` | unit |
| GW-005 | 게이트웨이 | 같은 시퀀스는 재발행하지 않음 | seq 5 두 번, 이어서 6 | 5 는 1회만, 6 은 새로 발행 | `gateway/tests/test_convert.py::test_same_sequence_number_is_not_published_twice` | unit |
| GW-006 | 게이트웨이 | 초기 시퀀스 0 | seq=0 | 발행 없음 | `gateway/tests/test_convert.py::test_initial_zero_sequence_publishes_nothing` | unit |
| GW-007 | 게이트웨이 | 재시작 후 재읽기 | 새 브리지 인스턴스가 같은 seq=9 을 읽음 | 이전과 같은 event_id (API 가 중복으로 걸러냄) | `gateway/tests/test_convert.py::test_restarted_bridge_republishes_same_event_id_so_api_can_drop_it` | unit |
| WEB-001 | 웹/지표 엔진 | 백분위(nearest-rank) | 1..100, 빈 목록 | API 와 같은 값, 빈 목록은 null | `web/src/lib/metrics.test.ts::percentile uses nearest rank and handles empty input` | unit |
| WEB-002 | 웹/지표 엔진 | 1초 버킷 경계 | 100.999 와 101.0 | 다른 버킷 | `web/src/lib/metrics.test.ts::events 1 ms apart across a second boundary land in different 1 s buckets` | unit |
| WEB-003 | 웹/지표 엔진 | 5초 버킷 경계 | 104.9 와 105.0 | 5의 배수에서 분리 | `web/src/lib/metrics.test.ts::5 s step buckets split exactly at the multiple of five` | unit |
| WEB-004 | 웹/지표 엔진 | 중복률 | 저장 3, 중복 1, 거부 1 | dup_rate=0.2 | `web/src/lib/metrics.test.ts::duplicate rate is duplicates over everything received` | unit |
| WEB-005 | 웹/지표 엔진 | 라인 필터 | line-a | 타 라인·거부 제외 | `web/src/lib/metrics.test.ts::line filter drops other lines and rejected messages` | unit |
| WEB-006 | 웹/지표 엔진 | 요약 p50/p95 | 지연 1..100ms 분산 | p50=50 p95=95 | `web/src/lib/metrics.test.ts::summary p50/p95 are computed over all latencies, not averaged per bucket` | unit |
| WEB-007 | 웹/지표 엔진 | 빈 구간 | 데이터 없음 | null 지연, 0 건 | `web/src/lib/metrics.test.ts::empty buckets have null latency and zero counts` | unit |
| WEB-008 | 웹/지표 엔진 | 라인별 입출고 | in/out 수량 | 합계와 라인별 값 일치 | `web/src/lib/metrics.test.ts::tag_read quantities are summed per line and direction` | unit |
| WEB-009 | 웹/지표 엔진 | 보관 기간 정리 | 보관 60초 | 오래된 버킷 삭제 | `web/src/lib/metrics.test.ts::buckets older than the retention window are pruned` | unit |
| WEB-010 | 웹/지표 엔진 | 초당 처리량 | 10초치 이벤트, 300초 창 | 1.0 | `web/src/lib/metrics.test.ts::per-second rate divides by the elapsed span, not the whole window` | unit |
| WEB-011 | 웹/지표 엔진 | 최근 N초 처리량 | 마지막 5초에 몰린 이벤트 | 10초 평균 1.5 | `web/src/lib/metrics.test.ts::recentRate averages only the most recent seconds of a snapshot` | unit |
| WEB-012 | 웹/지표 엔진 | 시리즈 지연은 5초 이동 창 | 900ms 1건 + 이후 10ms | API 와 같은 값(100~104초 900, 105초부터 10, 이전 null) | `web/src/lib/metrics.test.ts::series latency percentiles use a 5 s moving window instead of single-second needles` | unit |
| WEB-013 | 웹/시뮬레이터 | 토픽 규약과 페이로드 | TS 시뮬레이터 1틱 | `factory/line-x/dev/event` 형식, event_id 32자 hex, ts 유효 | `web/src/lib/demoSim.test.ts::topics follow factory/{line}/{device}/{event} and payload carries event_id + ts` | unit |
| WEB-014 | 웹/시뮬레이터 | 엔진의 중복 무시 | 중복률 50% 로 300틱 | seen+duplicates=전달 수, 순증감=입고-출고 | `web/src/lib/demoSim.test.ts::engine ignores redelivered event_id and keeps inventory consistent` | unit |
| WEB-015 | 웹/시뮬레이터 | 시드 재현성 | 같은 seed | 같은 토픽 시퀀스 | `web/src/lib/demoSim.test.ts::same seed gives the same stream shape` | unit |
| WEB-016 | 웹/데이터 출처 | 시작 상태 | 백엔드 없음 / 있음 | 없으면 sim, 있으면 waking(wait_server) | `web/src/lib/sourceMachine.test.ts::without a backend the browser simulation starts directly; with one it starts waking` | unit |
| WEB-017 | 웹/데이터 출처 | 켜는 중 단계 전환 | unreachable -> starting -> ready -> data | wait_server -> starting -> ready -> live | `web/src/lib/sourceMachine.test.ts::wake stages advance: unreachable -> starting -> ready, then data makes it live` | unit |
| WEB-018 | 웹/데이터 출처 | degraded 단계 | status=degraded 후 ready | 패널 유지(degraded), 회복하면 ready | `web/src/lib/sourceMachine.test.ts::a degraded server keeps the panel up with the degraded stage and can recover` | unit |
| WEB-019 | 웹/데이터 출처 | 시간 초과와 재시도 | wake_timeout, retry | timeout -> waking(wait_server) | `web/src/lib/sourceMachine.test.ts::no answer within the timeout ends in timeout; retry goes back to waking` | unit |
| WEB-020 | 웹/데이터 출처 | 시뮬레이션은 사용자가 고를 때만 | timeout 후 choose_sim, 다시 retry | timeout 이 자동으로 sim 이 되지 않음, 선택 시 sim, retry 시 waking | `web/src/lib/sourceMachine.test.ts::the simulation is only entered by an explicit choice, and the user can go back` | unit |
| WEB-021 | 웹/데이터 출처 | 연결 끊김과 복구 | live 에서 ws_closed, 이후 data | reconnecting -> live, 그 사이 status 이벤트는 단계를 바꾸지 않음 | `web/src/lib/sourceMachine.test.ts::a dropped live connection goes to reconnecting and returns to live on data` | unit |
| WEB-022 | 웹/데이터 출처 | 켜는 중 WebSocket 종료 | ready 직후 ws_closed | waking 유지(wait_server) | `web/src/lib/sourceMachine.test.ts::a websocket close while still waking does not leave the wake phase` | unit |
| WEB-023 | 웹/데이터 출처 | 늦은 timeout 무시 | live 이후 wake_timeout | live 유지 | `web/src/lib/sourceMachine.test.ts::late timeout events are ignored once live` | unit |
| WEB-024 | 웹/데이터 출처 | 실패 항목 목록 | db ok, mqtt error, simulator pending | `MQTT: error`, `시뮬레이터: pending` | `web/src/lib/sourceMachine.test.ts::failingChecks lists only the unhealthy checks` | unit |
| WEB-025 | 웹/데이터 출처 | 시간 초과 기본값 | 설정 없음 | 90초 | `web/src/lib/sourceMachine.test.ts::wake timeout defaults to 90 seconds` | unit |
| WEB-026 | 웹/데이터 출처 | 출처 배지 색 | waking/timeout, live(ready·degraded), reconnecting, sim | 초록은 연결·정상일 때만, 켜는 중은 호박색, 끊김은 빨강, 시뮬레이션은 별도 표시 | `web/src/lib/sourceMachine.test.ts::the source badge is green only when the server is connected and healthy` | unit |
| WEB-027 | 웹/토폴로지 | 켜는 중에는 노드가 대기(회색) | waking/timeout, 모든 check pending | 이상(bad) 노드 없음, API 대기, 관제 화면만 정상 | `web/src/lib/topology.test.ts::while the server is waking the server-side nodes are waiting, not failed` | unit |
| WEB-028 | 웹/토폴로지 | degraded 는 실패한 항목만 이상 | db ok, mqtt error, simulator pending | MQTT 노드 bad, DB 노드 wait | `web/src/lib/topology.test.ts::a degraded status marks only the failing checks as bad` | unit |
| WEB-029 | 웹/토폴로지 | 브라우저 시뮬레이션은 모든 노드 정상 | phase=sim | 6개 노드 모두 ok | `web/src/lib/topology.test.ts::browser simulation shows every node healthy` | unit |
| WEB-030 | 웹/토폴로지 | 연결 후 끊기면 이상 | phase=reconnecting | API·DB·WebSocket bad, 관제 화면 ok | `web/src/lib/topology.test.ts::a connection lost after being live marks the server-side nodes as bad` | unit |
| WEB-031 | 웹/토폴로지 | 연결 중 노드는 status 체크를 따름 | live + db error | 모두 ok, db error 이면 PostgreSQL 노드만 bad | `web/src/lib/topology.test.ts::live nodes follow the status checks` | unit |
| E2E-001 | E2E/대시보드 | 7개 블록 렌더링 | 백엔드 없는 정적 모드 | KPI 5, 차트 3, 장비 타일 10, 토폴로지 노드 6(모두 정상, 이름 아래 "브라우저 시뮬레이션"), 테일·입출고 행, 출처 배지 sim | `web/e2e/dashboard.spec.ts::E2E-01 dashboard renders all seven blocks in browser-simulation mode` | e2e |
| E2E-002 | E2E/대시보드 | KPI·테일 갱신 | 3~6초 대기 | 마지막 갱신 시각과 테일 첫 줄이 바뀜, KPI 값 표시 | `web/e2e/dashboard.spec.ts::E2E-02 KPI values and the tail keep updating while live` | e2e |
| E2E-003 | E2E/대시보드 | 장비 타일 클릭 필터 | amr-01 타일 클릭, 다시 클릭 | 테일이 해당 장비 줄만 표시, 재클릭 시 해제 | `web/e2e/dashboard.spec.ts::E2E-03 clicking a device tile filters the event tail to that device` | e2e |
| E2E-004 | E2E/대시보드 | 일시정지 | 일시정지 후 2.5초, 재개 | 화면·갱신 시각 고정, 재개하면 다시 갱신 | `web/e2e/dashboard.spec.ts::E2E-04 pause freezes the view and resume restarts it` | e2e |
| E2E-005 | E2E/대시보드 | 다크/라이트 전환 | 전환 버튼 두 번 | data-theme 전환, 배경색 변경 후 복귀 | `web/e2e/dashboard.spec.ts::E2E-05 theme toggle switches between dark and light and changes the background` | e2e |
| E2E-006 | E2E/대시보드 | 라인 필터 | line-a 선택 | 타일 5개(모두 line-a), 온라인 5/5 | `web/e2e/dashboard.spec.ts::E2E-06 line filter narrows tiles and KPIs to one line` | e2e |
| E2E-007 | E2E/서버 연결 | 켜는 중 패널과 단계 | 목 서버: 503 -> starting -> ready | 대기 중 배지 "서버 켜는 중"(waking)과 토폴로지 노드 대기(회색), wait_server -> starting(체크 목록) -> 패널 사라짐, 배지 "실시간 서버"(live)와 노드 정상, 서버 정상 | `web/e2e/server-flow.spec.ts::E2E-07 waking panel walks through the stages and gives way to live data` | e2e |
| E2E-008 | E2E/서버 연결 | 시간 초과 | 서버 무응답, 제한 3초 | "서버가 아직 켜지지 않았습니다" + 다시 시도 + 브라우저 시뮬레이션 버튼, 배지는 waking 유지(자동 전환 없음) | `web/e2e/server-flow.spec.ts::E2E-08 no answer within the timeout shows retry and simulation choices, not a silent fallback` | e2e |
| E2E-009 | E2E/서버 연결 | 시간 초과 후 다시 시도 | 서버가 이후 ready | 패널 사라지고 live | `web/e2e/server-flow.spec.ts::E2E-09 retry after a timeout connects once the server is up` | e2e |
| E2E-010 | E2E/서버 연결 | 브라우저 시뮬레이션 선택 | 시간 초과 후 해당 버튼 | 패널 사라짐, 출처 배지 sim 유지, "실제 서버 데이터가 아닙니다" 안내, 타일 10개 | `web/e2e/server-flow.spec.ts::E2E-10 choosing the browser simulation after a timeout keeps a visible source notice` | e2e |
| E2E-011 | E2E/서버 연결 | 연결 끊김과 재연결 | live 중 서버가 소켓을 닫음 | "서버 연결 끊김, 다시 연결하는 중" 배너와 배지 reconnecting, 재연결 후 배너 사라짐, 소켓 2회 연결 | `web/e2e/server-flow.spec.ts::E2E-11 a dropped connection shows the reconnect banner, then recovers` | e2e |
| E2E-012 | E2E/서버 연결 | 서버 이상(degraded) | mqtt=error 응답 | degraded 단계, 실패 항목 `MQTT: error`, MQTT 노드만 이상(bad), 다시 시도 버튼 | `web/e2e/server-flow.spec.ts::E2E-12 a degraded server names the failing check and offers retry` | e2e |
| E2E-013 | E2E/대시보드 | 시스템 색상 선호 | prefers-color-scheme: light | 라이트 테마로 시작 | `web/e2e/dashboard.spec.ts::E2E-13 a light colour-scheme preference starts the dashboard in the light theme` | e2e |
| INT-001 | 통합(실제 Mosquitto+Postgres) | MQTT 로 발행한 태그 읽기가 Postgres 에 저장·집계됨 | QoS1 tag_read(qty 4) | /api/events, /api/inventory(입고 4), /api/devices(rfid_gate) 반영 | `integration/test_live_stack.py::test_tag_read_published_over_mqtt_is_stored_in_postgres_and_counted` | integration |
| INT-002 | 통합(실제 Mosquitto+Postgres) | 같은 event_id 3회 발행 | 동일 메시지 x3 | 이벤트 1건, 입고 3 | `integration/test_live_stack.py::test_same_event_id_published_twice_is_stored_once` | integration |
| INT-003 | 통합(실제 Mosquitto+Postgres) | WebSocket 실시간 푸시 | 접속 후 status 발행 | snapshot 다음 해당 이벤트가 푸시됨, 장비 상태 charging | `integration/test_live_stack.py::test_websocket_pushes_a_new_event_to_connected_clients` | integration |
| INT-004 | 통합(실제 Mosquitto+Postgres) | /api/metrics 반영 | scan 1건을 2회 발행 | 라인 기준 stored=1 duplicates=1, p95 존재 | `integration/test_live_stack.py::test_metrics_endpoint_counts_stored_and_duplicate_messages` | integration |
| INT-005 | 통합(실제 Mosquitto+Postgres) | 깨진 메시지 후에도 소비 지속 | JSON 아닌 페이로드 후 정상 메시지 | rejected 증가, 이어서 정상 메시지 저장 | `integration/test_live_stack.py::test_malformed_message_is_rejected_and_counted_without_breaking_the_consumer` | integration |
| INT-006 | 통합(실제 Mosquitto+Postgres) | /api/status 연결 확인 | 스택 기동 후 | db=ok mqtt=ok, state 는 starting 또는 ready | `integration/test_live_stack.py::test_status_endpoint_reports_db_and_mqtt_connected` | integration |
