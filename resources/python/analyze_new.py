import easyocr
import re
import os, sys, json, time
import cv2, numpy as np
try:
    from ultralytics import YOLO
except Exception:
    YOLO = None

BASE = os.path.dirname(__file__)
WEIGHTS = os.path.join(BASE, 'models', 'best.pt')
model = YOLO(WEIGHTS) if YOLO is not None else None
ocr_reader = easyocr.Reader(['ch_sim', 'en'], gpu=False)

INPUT_BASE = os.path.join(BASE, 'app', 'data', 'input')
RESULT_BASE = os.path.join(BASE, 'app', 'result')
DETECT_BASE = os.path.join(BASE, 'app', 'detect')
HSV_COLOR = [
    (100, 124, 43, 255, 46, 255),
    (156, 180, 43, 255, 46, 255),
    (0, 11, 43, 255, 46, 255),
    (35, 77, 43, 255, 46, 255),
    (125, 155, 43, 255, 46, 255),
    (78, 99, 43, 255, 46, 255),
    (11, 25, 43, 255, 46, 255),
    (26, 34, 43, 255, 46, 255)
]
LABELS = ['1', '2', '3', '4', '5', '6', '7', '8']
MIN_POINTS = 400

def locate_name_region_by_template(full_img, template_name_img):
    """
    以匹配到的位置为锚点，在右侧截取一块作为姓名+ID 区域。
    """
    if template_name_img is None:
        return None, None

    h_t, w_t = template_name_img.shape[:2]

    # 只在图像上半部分搜索会更快，也更安全（姓名基本都在上方）
    h, w = full_img.shape[:2]
    search_region = full_img[0:int(h * 0.3), 0:w]   # 上 30%
    res = cv2.matchTemplate(search_region, template_name_img, cv2.TM_CCOEFF_NORMED)
    _, max_val, _, max_loc = cv2.minMaxLoc(res)

    ax, ay = max_loc  # anchor 左上角（在 search_region 里的坐标）
    ay_global = ay  # 因为 search_region 从 0 开始，所以这里不用加偏移
    left_margin = 200   # 头像左边再多截 200 像素
    right_margin = 200  # 头像右边再多截 200 像素

    # 以锚点右侧一块区域作为姓名+ID 的 ROI
    x0 = max(ax - left_margin, 0)
    y0 = max(ay_global - 5, 0)
    x1 = min(ax + w_t + right_margin, w)
    y1 = min(ay_global + h_t + 15, h)

    name_roi = full_img[y0:y1, x0:x1]
    return name_roi, (x0, y0, x1, y1)


def ocr_name_id_from_roi(name_roi):
    """
    对姓名+ID 的小图做 OCR，返回 (patient_id, patient_name, raw_text)
    """
    if name_roi is None:
        return None, None, ""

    gray = cv2.cvtColor(name_roi, cv2.COLOR_BGR2GRAY)
    # 提高对比度：自适应阈值 / OTSU
    gray = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1]

    # 识别中文 + 英文/数字
    texts = ocr_reader.readtext(gray, detail=0)
    raw_text = " ".join(texts).strip()

    # 用正则从中抽取「数字连续串 + 中文名字」
    # 示例： "360985282, 吴某女" / "360985282 吴毛女"
    pid = None
    name = None

    m_id = re.search(r'(\d{6,})', raw_text)
    if m_id:
        pid = m_id.group(1)
        tail = raw_text[m_id.end():]
        idx_year = tail.find('20')
        if idx_year != -1:
            tail = tail[:idx_year]

        name_chars = re.findall(r'[\u4e00-\u9fa5·]', tail)
        if name_chars:
            name = "".join(name_chars)

    # 如果上面逻辑没匹配到，再 fallback 到原来的简单规则
    if name is None:
        m = re.search(r'(\d+)\D*([\u4e00-\u9fa5·]+)', raw_text)
        if m:
            if pid is None:
                pid = m.group(1)
            name = m.group(2)

    return pid, name, raw_text

def mask_to_white_image(img, mask):
    white = np.full_like(img, 255)
    fg = cv2.bitwise_and(img, img, mask=mask)
    inv = cv2.bitwise_not(mask)
    bg = cv2.bitwise_and(white, white, mask=inv)
    return cv2.add(fg, bg)

def preprocess_edges(img):
    """
    在 img 中用 HoughLinesP 粗略找出一条竖直轴线和一条水平轴线，
    返回 edges, lines, zero_x, zero_y
    """
    image_gray = cv2.cvtColor(img.copy(), cv2.COLOR_BGR2GRAY)

    # 边缘阈值稍微放宽一点
    edges = cv2.Canny(image_gray, 80, 200, apertureSize=3)

    h, w = img.shape[:2]
    # 这里 minLineLength 用 min(h,w)*0.5，更容易检测到轴线
    lines = cv2.HoughLinesP(
        edges,
        1,
        np.pi / 180,
        threshold=80,
        minLineLength=int(min(h, w) * 0.5),
        maxLineGap=15
    )
    # 默认值：先设在图中间附近，防止完全找不到时报很离谱的点
    zero_x = w // 4
    zero_y = int(h * 0.75)

    if lines is not None and len(lines) > 0:
        best_v = None  # (长度, x中点)
        best_h = None  # (长度, y中点)

        for line in lines:
            x1, y1, x2, y2 = line[0]
            dx = abs(x2 - x1)
            dy = abs(y2 - y1)

            # 近似竖直线：dx 很小，dy 比较大
            if dx < 5 and dy > h * 0.3:
                length = dy
                x_mid = (x1 + x2) // 2
                if (best_v is None) or (length > best_v[0]):
                    best_v = (length, x_mid)

            # 近似水平线：dy 很小，dx 比较大
            if dy < 5 and dx > w * 0.3:
                length = dx
                y_mid = (y1 + y2) // 2
                if (best_h is None) or (length > best_h[0]):
                    best_h = (length, y_mid)

        if best_v is not None:
            zero_x = best_v[1]
        if best_h is not None:
            zero_y = best_h[1]

    return edges, lines, zero_x, zero_y


def locate_and_crop(side, template_img, template_times_img, save_dir, label):
    h_side, w_side = side.shape[:2]
    imgHSV = cv2.cvtColor(side, cv2.COLOR_BGR2HSV)
    mask_all = None
    for hsv in HSV_COLOR:
        h_min, h_max, s_min, s_max, v_min, v_max = hsv
        lower = np.array([h_min, s_min, v_min], dtype=np.uint8)
        upper = np.array([h_max, s_max, v_max], dtype=np.uint8)
        mask = cv2.inRange(imgHSV, lower, upper)
        if mask_all is None:
            mask_all = mask
        else:
            mask_all = cv2.bitwise_or(mask_all, mask)
    if mask_all is not None and np.count_nonzero(mask_all) > 0:
        k = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
        mask_all = cv2.morphologyEx(mask_all, cv2.MORPH_OPEN, k)
        contours, _ = cv2.findContours(mask_all, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if contours:
            c = max(contours, key=cv2.contourArea)
            x, y, w, h = cv2.boundingRect(c)
            pad_x, pad_y = 40, 80
            x0 = max(x - pad_x, 0)
            y0 = max(y - pad_y, 0)
            x1 = min(x + w + pad_x, w_side)
            y1 = min(y + h + pad_y, h_side)
            crop_img = side[y0:y1, x0:x1]
            crop_path = os.path.join(save_dir, f'{label}_cropped.png')
            cv2.imwrite(crop_path, crop_img, [cv2.IMWRITE_PNG_COMPRESSION, 0])
            return crop_img, crop_path
    if template_img is not None and template_times_img is not None:
        th, tw = template_img.shape[:2]
        res = cv2.matchTemplate(side, template_img, cv2.TM_CCOEFF_NORMED)
        _, _, _, max_loc = cv2.minMaxLoc(res)
        crop_img_all = side[max_loc[1]:max_loc[1] + th, max(max_loc[0] - 250, 0):max_loc[0] + tw + 200]
        crop_h, _ = crop_img_all.shape[:2]
        res2 = cv2.matchTemplate(template_times_img, crop_img_all, cv2.TM_CCOEFF)
        _, _, _, max_loc2 = cv2.minMaxLoc(res2)
        rect_h, _ = template_times_img.shape[:2]
        times_y = max_loc2[1] + (rect_h / 2)
        if times_y <= round(0.6 * crop_h):
            crop_img = side[max_loc[1]:max_loc[1] + round(th / 2), max(max_loc[0] - 250, 0):max_loc[0] + tw + 200]
        else:
            crop_img = side[max_loc[1] + round(th / 2):max_loc[1] + th, max(max_loc[0] - 300, 0):max_loc[0] + tw + 200]
        crop_path = os.path.join(save_dir, f'{label}_cropped.png')
        cv2.imwrite(crop_path, crop_img, [cv2.IMWRITE_PNG_COMPRESSION, 0])
        return crop_img, crop_path
    h, w = side.shape[:2]
    y0, y1 = round(h / 4), round(3 * h / 4)
    x0, x1 = 0, w
    crop_img = side[y0:y1, x0:x1]
    crop_path = os.path.join(save_dir, f'{label}_cropped.png')
    cv2.imwrite(crop_path, crop_img, [cv2.IMWRITE_PNG_COMPRESSION, 0])
    return crop_img, crop_path

def locate_and_crop_left_template(side, template_img, save_dir):
    h_t, w_t = template_img.shape[:2]
    h_side, w_side = side.shape[:2]

    search_top = int(h_side * 0.4)
    search_region = side[search_top:h_side, 0:w_side]

    res = cv2.matchTemplate(search_region, template_img, cv2.TM_CCOEFF_NORMED)
    _, _, _, max_loc = cv2.minMaxLoc(res)

    x0_t = max_loc[0]
    y0_t = max_loc[1] + search_top

    x1_t = min(x0_t + w_t + 90, w_side)
    y1_t = y0_t + h_t

    roi_full = side[y0_t:y1_t, x0_t:x1_t]

    _, _, zero_x, zero_y = preprocess_edges(roi_full)

    margin_left = 10  
    crop_x0 = max(zero_x - margin_left, 0)

    crop_img = roi_full[:, crop_x0:]

    crop_path = os.path.join(save_dir, 'left_cropped.png')
    cv2.imwrite(crop_path, crop_img, [cv2.IMWRITE_PNG_COMPRESSION, 0])

    return crop_img, crop_path
    # offset_left = 150   # 往右挪，防止包含X的负半轴
    # x0 = max(max_loc[0] + offset_left, 0)
    # y0 = max_loc[1]
    # x1 = min(x0 + w + 90 - offset_left, side.shape[1])
    # y1 = y0 + h
    # crop_img = side[y0:y1, x0:x1]
    # crop_path = os.path.join(save_dir, 'left_cropped.png')
    # cv2.imwrite(crop_path, crop_img, [cv2.IMWRITE_PNG_COMPRESSION, 0])
    # return crop_img, crop_path

def compute_scales(crop_img, template_x4_img, template_y10_img, zero_x, zero_y):
    if template_x4_img is None or template_y10_img is None:
        return 1.0, 1.0, zero_x + 4.0, zero_y - 10.0
    resx = cv2.matchTemplate(template_x4_img, crop_img, cv2.TM_CCOEFF)
    _, _, _, max_locx = cv2.minMaxLoc(resx)
    rect_hx, rect_wx = template_x4_img.shape[:2]
    x_4 = max_locx[0] + (rect_wx / 2)
    x_scale = (x_4 - zero_x) / 4 if (x_4 - zero_x) != 0 else 1.0
    resy = cv2.matchTemplate(template_y10_img, crop_img, cv2.TM_CCOEFF)
    _, _, _, max_locy = cv2.minMaxLoc(resy)
    rect_hy, rect_wy = template_y10_img.shape[:2]
    y_10 = max_locy[1] + (rect_hy / 2)
    y_scale = abs((zero_y - y_10) / 10) if (zero_y - y_10) != 0 else 1.0
    return x_scale, y_scale, x_4, y_10

def extract_points_from_hsv(crop_img, zero_x, zero_y, x_scale, y_scale, save_dir, label, save_color_images=True):
    imgHSV = cv2.cvtColor(crop_img, cv2.COLOR_BGR2HSV)
    points = []
    color_artifacts = []
    for i, hsv in enumerate(HSV_COLOR):
        h_min, h_max, s_min, s_max, v_min, v_max = hsv
        lower = np.array([h_min, s_min, v_min], dtype=np.uint8)
        upper = np.array([h_max, s_max, v_max], dtype=np.uint8)
        mask = cv2.inRange(imgHSV, lower, upper)
        ys, xs = np.where(mask != 0)
        if xs.size == 0:
            continue
        if save_color_images:
            color_path = os.path.join(save_dir, f'{label}-color{i}.png')
            if xs.size + ys.size >= MIN_POINTS:
                img_white = mask_to_white_image(crop_img, mask)
                cv2.imwrite(color_path, img_white, [cv2.IMWRITE_PNG_COMPRESSION, 0])
                color_artifacts.append(color_path)
        xs_f = (xs - zero_x) / (x_scale if x_scale != 0 else 1.0)
        ys_f = ((ys - zero_y) * -1) / (y_scale if y_scale != 0 else 1.0)
        lbl = LABELS[i]
        for xx, yy in zip(xs_f.tolist(), ys_f.tolist()):
            points.append([lbl, float(xx), float(yy)])
    return points, color_artifacts

def extract_curves_for_image(image_path, save_dir):
    img = cv2.imread(image_path)
    if img is None:
        return {
            'left': {'points': []},
            'patient_id': None,
            'patient_name': None,
            'name_text_raw': ''
        }, []

    h, w = img.shape[:2]

    # ========= 1. 左上角姓名 + ID =========
    template_name_img = cv2.imread(os.path.join(INPUT_BASE, 'peple.png'))
    name_roi, name_box = locate_name_region_by_template(img, template_name_img)

    patient_id, patient_name, name_text_raw = ocr_name_id_from_roi(name_roi)

    if name_roi is not None:
        name_roi_path = os.path.join(save_dir, 'name_roi.png')
        cv2.imwrite(name_roi_path, name_roi, [cv2.IMWRITE_PNG_COMPRESSION, 0])
    else:
        name_roi_path = None

    # ========= 2. 左下角曲线区域（沿用原有模板匹配方案） =========
    left_side = img[0:h, 0:int(w / 2)]

    template_img = cv2.imread(os.path.join(INPUT_BASE, 'template_new.png'))
    template_x4_img = cv2.imread(os.path.join(INPUT_BASE, 'template_x4_new.png'))
    template_y10_img = cv2.imread(os.path.join(INPUT_BASE, 'template_y10_new.png'))
    template_times_img = cv2.imread(os.path.join(INPUT_BASE, 'temple_times.png'))

    data_table = img[600:int(h / 2) + 100, 0:w]
    data_table_path = os.path.join(save_dir, 'data_table.png')
    cv2.imwrite(data_table_path, data_table, [cv2.IMWRITE_PNG_COMPRESSION, 0])

    artifacts = []
    if data_table_path:
        artifacts.append(data_table_path)
    if name_roi_path:
        artifacts.append(name_roi_path)

    # # 用模板定位左侧曲线区域
    # left_crop, left_crop_path = locate_and_crop_left_template(left_side, template_img, save_dir)
    # artifacts.append(left_crop_path)

    # # 找零点、刻度，并提取彩色曲线点 + 白底曲线小图
    # _, _, zero_x_l, zero_y_l = preprocess_edges(left_crop)
    # x_scale_l, y_scale_l, _, _ = compute_scales(left_crop, template_x4_img, template_y10_img, zero_x_l, zero_y_l)

    # left_points, left_color_artifacts = extract_points_from_hsv(
    #     left_crop, zero_x_l, zero_y_l, x_scale_l, y_scale_l,
    #     save_dir, 'left', save_color_images=True
    # )
    # # left_color_artifacts 就是每条曲线「白底+彩色」的小图路径
    # artifacts.extend(left_color_artifacts)

    # 先用模板定位左侧整体曲线区域（包含负轴）
    left_crop, left_crop_path = locate_and_crop_left_template(left_side, template_img, save_dir)

    # 在整块图上检测坐标轴原点
    _, _, zero_x_l, zero_y_l = preprocess_edges(left_crop)

    margin_left = 10 
    crop_x0 = max(zero_x_l - margin_left, 0)

    left_crop_pos = left_crop[:, crop_x0:]

    # 裁剪之后，新的 zero_x 相对这张新图的位置
    zero_x_l_new = zero_x_l - crop_x0 
    zero_y_l_new = zero_y_l

    # 用正半轴图片覆盖保存 left_cropped.png
    left_crop = left_crop_pos
    left_crop_path = os.path.join(save_dir, 'left_cropped.png')
    cv2.imwrite(left_crop_path, left_crop, [cv2.IMWRITE_PNG_COMPRESSION, 0])
    artifacts.append(left_crop_path)

    x_scale_l, y_scale_l, _, _ = compute_scales(
        left_crop, template_x4_img, template_y10_img, zero_x_l_new, zero_y_l_new
    )

    left_points, left_color_artifacts = extract_points_from_hsv(
        left_crop, zero_x_l_new, zero_y_l_new, x_scale_l, y_scale_l,
        save_dir, 'left', save_color_images=True
    )

    curves = {
        'left': {
            'points': left_points,
            'curve_images': left_color_artifacts  # 关键输出：白底曲线图
        },
        'patient_id': patient_id,
        'patient_name': patient_name,
        'name_text_raw': name_text_raw
    }
    return curves, artifacts

def run_yolo_on_curves(curve_files, detect_proj, curves_detect_name):
    curves_pred = []
    for cf in curve_files:
        cboxes = []
        if model is not None:
            cr = model.predict(source=cf, conf=0.25, verbose=False, save=True, project=detect_proj, name=curves_detect_name, exist_ok=True)
            for r in cr:
                for b in r.boxes:
                    xywh = b.xywh.tolist()[0]
                    cboxes.append({'xywh': xywh, 'cls': int(b.cls), 'conf': float(b.conf)})
        curves_pred.append({'image': cf, 'boxes': cboxes, 'summary': f'detected {len(cboxes)}'})
    return curves_pred

def annotate_image_with_predictions(image_path, points, boxes, save_path):
    img = cv2.imread(image_path)
    if img is None:
        return False
    for box in boxes:
        x, y, w, h = box['xywh']
        x1 = int(x - w / 2)
        y1 = int(y - h / 2)
        x2 = int(x + w / 2)
        y2 = int(y + h / 2)
        cv2.rectangle(img, (x1, y1), (x2, y2), (0, 255, 0), 2)
    cv2.imwrite(save_path, img, [cv2.IMWRITE_PNG_COMPRESSION, 0])
    return True

def process_image_end_to_end(image_path):
    t0 = time.time()
    date_dir = os.path.basename(os.path.dirname(image_path))
    base_name = os.path.splitext(os.path.basename(image_path))[0]
    save_dir = os.path.join(RESULT_BASE, date_dir, base_name)
    os.makedirs(save_dir, exist_ok=True)

    curves, artifacts = extract_curves_for_image(image_path, save_dir)

    curve_files = curves["left"]["curve_images"][1:]

    # YOLO 检测输出目录
    detect_root = os.path.join(DETECT_BASE, date_dir)
    curves_detect_name = base_name + "-curves"
    detect_dir = os.path.join(detect_root, curves_detect_name)
    os.makedirs(detect_dir, exist_ok=True)

    #  跑 YOLO：只返回 boxes 信息，预测图由 YOLO 自己保存到 detect_dir
    curves_pred = run_yolo_on_curves(
        curve_files,
        detect_proj=detect_root,
        curves_detect_name=curves_detect_name,
    )

    out = {
        "patient_id": curves.get("patient_id"),
        "patient_name": curves.get("patient_name"),
        "name_text_raw": curves.get("name_text_raw"),

        # 裁剪后的白底单条曲线图（在 result 目录）
        "curve_images": curve_files,

        # YOLO 相关信息
        "yolo": {
            "curves": curves_pred,        # 每张输入图对应的检测框
            "detect_dir": detect_dir,     # Ultralytics 保存预测图的目录
            # 不再返回我们自画的 annotated_files
        },

        "meta": {
            "runtime_ms": int((time.time() - t0) * 1000),
            "version": "v3-spirometry-yolo",
            "patient_name": curves.get("patient_name"),
        },
        "output_dir": save_dir, 
        "artifacts": artifacts,
    }
    return out
    # os.makedirs(os.path.join(detect_proj, curves_detect_name), exist_ok=True)
    # curve_files = []
    # for fn in os.listdir(save_dir):
    #     if fn.lower().endswith('.png') and fn.lower() != 'data_table.png':
    #         curve_files.append(os.path.join(save_dir, fn))
    # curves_pred = run_yolo_on_curves(curve_files, detect_proj, curves_detect_name)
    # boxes = []
    # for item in curves_pred:
    #     boxes.extend(item['boxes'])
    # annotated_files = []
    # pts_all = curves['left']['points'] + curves['right']['points']
    # for cf in curve_files:
    #     ap = os.path.join(save_dir, os.path.splitext(os.path.basename(cf))[0] + '-annotated.png')
    #     ok = annotate_image_with_predictions(cf, pts_all, boxes, ap)
    #     if ok:
    #         annotated_files.append(ap)
    # out = {
    #     'patient_id': 'UNKNOWN',
    #     'yolo': {
    #         'boxes': boxes,
    #         'summary': f'detected {len(boxes)} across {len(curve_files)} images',
    #         'runtime_ms': int((time.time() - t0) * 1000),
    #         'curves_dir': os.path.join(detect_proj, curves_detect_name),
    #         'curves': curves_pred
    #     },
    #     'curve': curves,
    #     'meta': {'version': 'v1'},
    #     'artifacts': artifacts,
    #     'annotated': annotated_files,
    #     'output_dir': save_dir
    # }
    # return out

if __name__ == '__main__':
    img_path = None
    if len(sys.argv) >= 2:
        img_path = sys.argv[1]
    else:
        try:
            if not sys.stdin.isatty():
                raw = sys.stdin.read()
                raw = raw.strip().lstrip('\ufeff')
                if raw:
                    req = json.loads(raw)
                    img_path = req.get('image_path')
        except Exception:
            img_path = None
    if not img_path:
        print(json.dumps({'error': 'missing image_path'}), flush=True)
        sys.exit(1)
    try:
        result = process_image_end_to_end(img_path)
        print(json.dumps(result, ensure_ascii=False), flush=True)
    except Exception as e:
        print(json.dumps({'error': str(e)}), flush=True)